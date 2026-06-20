// Resilient audio source loader for the YNG music archive.
//
// The browser's native <audio> streaming does just-in-time HTTP range requests
// straight from S3 (no CDN), so it stalls the instant the connection dips. This
// loader instead pulls each compressed track with a single continuous fetch and
// races the download ahead of playback, guaranteeing a smooth, gap-free listen
// once playback begins. Strategy, in order of preference:
//
//   1. In-memory blob       -> instant replay within a session.
//   2. Cache API blob        -> instant replay across reloads / offline.
//   3. MediaSource streaming -> start in ~2s, buffer the rest ahead at line rate
//                               (MP3 on Chromium/Firefox/Android).
//   4. Full-download blob     -> fetch everything, then play (WAV, or no MSE).
//   5. Native element src     -> last resort, never worse than before.
//
// Downloaded bytes are always persisted to the Cache API and a small in-memory
// LRU, so the next play of the same track is instant. The next track in the
// queue can be prefetched in the background for an instant transition.

const AUDIO_CACHE_NAME = 'yng-music-audio-v1';
const CACHE_INDEX_KEY = 'yngMusicAudioCacheIndex';
const MAX_CACHED_TRACKS = 80;
const MAX_MEMORY_BLOBS = 8;
const MSE_MIME = 'audio/mpeg';

function mimeForTrack(track) {
  return track?.format === 'wav' ? 'audio/wav' : MSE_MIME;
}

function supportsMse() {
  const MS = typeof window !== 'undefined' ? window.MediaSource : null;
  return Boolean(MS && typeof MS.isTypeSupported === 'function' && MS.isTypeSupported(MSE_MIME));
}

function supportsCacheApi() {
  return typeof caches !== 'undefined';
}

function readCacheIndex() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_INDEX_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCacheIndex(index) {
  try {
    window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage may be full or unavailable; the cache still works without LRU metadata.
  }
}

function touchCacheIndex(url) {
  const index = readCacheIndex();
  index[url] = Date.now();
  writeCacheIndex(index);
}

async function trimCache(cache) {
  const index = readCacheIndex();
  const urls = Object.keys(index);
  if (urls.length <= MAX_CACHED_TRACKS) return;

  const stale = urls
    .sort((a, b) => index[a] - index[b])
    .slice(0, urls.length - MAX_CACHED_TRACKS);

  for (const url of stale) {
    try {
      await cache.delete(url);
    } catch {
      // Ignore individual eviction failures.
    }
    delete index[url];
  }
  writeCacheIndex(index);
}

async function cacheMatch(url) {
  if (!supportsCacheApi()) return null;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    touchCacheIndex(url);
    return await response.blob();
  } catch {
    return null;
  }
}

async function cacheHas(url) {
  if (!supportsCacheApi()) return false;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    return Boolean(await cache.match(url));
  } catch {
    return false;
  }
}

async function cachePut(url, blob, mime) {
  if (!supportsCacheApi() || !blob?.size) return;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = new Response(blob, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(blob.size),
      },
    });
    await cache.put(url, response);
    touchCacheIndex(url);
    await trimCache(cache);
  } catch {
    // Quota or transient errors are non-fatal; playback already happened from memory.
  }
}

export function createTrackLoader({ onState, onProgress } = {}) {
  const canUseMse = supportsMse();
  const memoryBlobs = new Map(); // trackId -> { url, size }
  let session = null;
  let prefetchInFlight = 0;

  function emitState(track, state) {
    try {
      onState?.(track, state);
    } catch {
      // Listener errors must never break playback.
    }
  }

  function emitProgress(track, info) {
    try {
      onProgress?.(track, info);
    } catch {
      // Listener errors must never break playback.
    }
  }

  function rememberBlob(track, blob) {
    const existing = memoryBlobs.get(track.id);
    if (existing) {
      memoryBlobs.delete(track.id);
      memoryBlobs.set(track.id, existing);
      return existing.url;
    }

    const url = URL.createObjectURL(blob);
    memoryBlobs.set(track.id, { url, size: blob.size });

    while (memoryBlobs.size > MAX_MEMORY_BLOBS) {
      const oldestId = memoryBlobs.keys().next().value;
      const entry = memoryBlobs.get(oldestId);
      // Never revoke the URL the active element is currently playing from.
      if (session && session.activeUrl === entry.url) {
        memoryBlobs.delete(oldestId);
        memoryBlobs.set(oldestId, entry);
        break;
      }
      URL.revokeObjectURL(entry.url);
      memoryBlobs.delete(oldestId);
    }

    return url;
  }

  function teardownMediaSource(target) {
    if (target?.objectUrl) {
      try {
        URL.revokeObjectURL(target.objectUrl);
      } catch {
        // Already revoked.
      }
      target.objectUrl = null;
    }
  }

  function teardown() {
    if (!session) return;
    session.disposed = true;
    try {
      session.abort?.();
    } catch {
      // AbortController may already be settled.
    }
    teardownMediaSource(session);
    session = null;
  }

  function streamViaMse(element, track, localSession) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let streamDone = false;
      let sourceBuffer = null;
      const queue = [];
      const chunks = [];
      const total = Number(track.sizeBytes) || 0;
      let received = 0;

      const mediaSource = new window.MediaSource();
      const objectUrl = URL.createObjectURL(mediaSource);
      const controller = new AbortController();

      localSession.mediaSource = mediaSource;
      localSession.objectUrl = objectUrl;
      localSession.activeUrl = objectUrl;
      localSession.abort = () => controller.abort();

      const settleReady = () => {
        if (resolved) return;
        resolved = true;
        resolve({ source: 'mse' });
      };

      const pump = () => {
        if (!sourceBuffer || sourceBuffer.updating) return;
        if (queue.length) {
          try {
            sourceBuffer.appendBuffer(queue.shift());
          } catch {
            // Quota exceeded or invalid append: stop feeding, keep what played.
            try {
              if (mediaSource.readyState === 'open') mediaSource.endOfStream();
            } catch {
              // ignore
            }
          }
          return;
        }
        if (streamDone && mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch {
            // ignore
          }
        }
      };

      mediaSource.addEventListener('sourceopen', async () => {
        if (localSession.disposed) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(MSE_MIME);
        } catch (error) {
          reject(error);
          return;
        }

        sourceBuffer.addEventListener('updateend', () => {
          settleReady();
          pump();
        });

        try {
          const response = await fetch(track.url, { signal: controller.signal, cache: 'force-cache' });
          if (!response.ok || !response.body) throw new Error(`fetch ${response.status}`);

          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (localSession.disposed) return;
            chunks.push(value);
            queue.push(value);
            received += value.length;
            emitProgress(track, {
              receivedBytes: received,
              totalBytes: total,
              fraction: total ? Math.min(1, received / total) : 0,
            });
            pump();
          }

          streamDone = true;
          pump();

          const blob = new Blob(chunks, { type: MSE_MIME });
          rememberBlob(track, blob);
          cachePut(track.url, blob, MSE_MIME);
        } catch (error) {
          if (controller.signal.aborted || localSession.disposed) return;
          if (!resolved) reject(error);
        }
      });

      element.src = objectUrl;
      try {
        element.load();
      } catch {
        // Some browsers reload implicitly; safe to ignore.
      }
    });
  }

  async function streamToBlob(element, track, localSession) {
    const controller = new AbortController();
    localSession.abort = () => controller.abort();

    const response = await fetch(track.url, { signal: controller.signal, cache: 'force-cache' });
    if (!response.ok) throw new Error(`fetch ${response.status}`);

    const total = Number(response.headers.get('Content-Length')) || Number(track.sizeBytes) || 0;
    const mime = mimeForTrack(track);

    let blob;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (localSession.disposed) return { source: 'aborted' };
        chunks.push(value);
        received += value.length;
        emitProgress(track, {
          receivedBytes: received,
          totalBytes: total,
          fraction: total ? Math.min(1, received / total) : 0,
        });
      }
      blob = new Blob(chunks, { type: mime });
    } else {
      blob = await response.blob();
    }

    if (localSession.disposed) return { source: 'aborted' };

    const url = rememberBlob(track, blob);
    localSession.activeUrl = url;
    element.src = url;
    cachePut(track.url, blob, mime);
    return { source: 'blob' };
  }

  async function attach(element, track) {
    teardown();
    const localSession = {
      track,
      abort: null,
      mediaSource: null,
      objectUrl: null,
      activeUrl: null,
      disposed: false,
    };
    session = localSession;

    // 1. In-memory blob — instant.
    const remembered = memoryBlobs.get(track.id);
    if (remembered) {
      memoryBlobs.delete(track.id);
      memoryBlobs.set(track.id, remembered);
      element.src = remembered.url;
      localSession.activeUrl = remembered.url;
      emitState(track, 'cached');
      return { source: 'memory' };
    }

    // 2. Persistent Cache API blob — instant across reloads / offline.
    const cachedBlob = await cacheMatch(track.url);
    if (localSession.disposed) return { source: 'aborted' };
    if (cachedBlob?.size) {
      const url = rememberBlob(track, cachedBlob);
      element.src = url;
      localSession.activeUrl = url;
      emitState(track, 'cached');
      return { source: 'cache' };
    }

    emitState(track, 'buffering');

    // 3. MediaSource streaming — start fast, buffer ahead (compressed audio only).
    if (canUseMse && track.format !== 'wav') {
      try {
        const result = await streamViaMse(element, track, localSession);
        if (localSession.disposed) return { source: 'aborted' };
        emitState(track, 'streaming');
        return result;
      } catch {
        if (localSession.disposed) return { source: 'aborted' };
        teardownMediaSource(localSession);
        localSession.abort = null;
      }
    }

    // 4. Full-download blob — bulletproof, used for WAV / Safari / MSE failures.
    try {
      const result = await streamToBlob(element, track, localSession);
      if (localSession.disposed) return { source: 'aborted' };
      if (result.source !== 'aborted') emitState(track, 'ready');
      return result;
    } catch {
      if (localSession.disposed) return { source: 'aborted' };
    }

    // 5. Native streaming — last resort, identical to the previous behaviour.
    element.src = track.url;
    localSession.activeUrl = track.url;
    emitState(track, 'native');
    return { source: 'native' };
  }

  async function prefetch(track) {
    if (!track || track.format === 'wav') return;
    if (prefetchInFlight > 0) return; // One background download at a time — never steal bandwidth from playback.
    if (memoryBlobs.has(track.id)) return;
    if (await cacheHas(track.url)) return;

    prefetchInFlight += 1;
    try {
      const response = await fetch(track.url, { cache: 'force-cache' });
      if (!response.ok) return;
      const blob = await response.blob();
      await cachePut(track.url, blob, mimeForTrack(track));
    } catch {
      // Prefetch is best-effort.
    } finally {
      prefetchInFlight -= 1;
    }
  }

  function getReadyUrl(track) {
    return memoryBlobs.get(track?.id)?.url || null;
  }

  function isReady(track) {
    return memoryBlobs.has(track?.id);
  }

  return { attach, prefetch, getReadyUrl, isReady, teardown };
}
