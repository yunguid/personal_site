// Gated audio loader for the YNG music archive.
//
// The old engine optimized for instant start: play from the first chunk and
// hope the network keeps up. On anything slower than the bitrate that means
// stall/resume flapping through the whole song. This engine makes the opposite
// trade, deliberately: wait a little up front, then play clean.
//
// One fetch per track drives everything — MediaSource appends, progress UI,
// and cache persistence. There is never a second parallel download of the same
// file. Playback is released by a gate:
//
//   start when   remaining download time × SAFETY ≤ remaining play time
//   and          the element has ≥ MIN_START_LEAD seconds buffered
//
// Under steady throughput that condition guarantees the download frontier
// stays ahead of the playhead until the end of the song. If throughput drops
// mid-play and the element still runs dry, the gate pauses it once, cleanly,
// and resumes only after REBUFFER_LEAD seconds of cushion exist — one audible
// gap instead of machine-gun stutter.
//
// Source order per attach():
//   1. In-memory blob        -> instant replay within a session.
//   2. Cache API blob        -> instant replay across reloads / offline.
//   3. Gated MSE streaming   -> compressed audio; MediaSource or iOS Safari's
//                               ManagedMediaSource. Mid-stream network errors
//                               resume with HTTP Range requests.
//   4. Blob download-to-play -> WAV / no MSE: full fetch with progress, then
//                               play from a local blob. Slower to start,
//                               impossible to stutter.
//   5. Bare native src       -> only if the fetch itself fails.
//
// Downloaded bytes persist to the Cache API and a small in-memory LRU.
// warmup() pre-fills the first few visible tracks after load; prefetch()
// warms hovered or upcoming tracks. Both yield to the foreground download.

const AUDIO_CACHE_NAME = 'yng-music-audio-v1';
const CACHE_INDEX_KEY = 'yngMusicAudioCacheIndex';
const MAX_CACHED_TRACKS = 80;
const MAX_MEMORY_BLOBS = 8;
const MSE_MIME = 'audio/mpeg';

const SAFETY = 1.4;               // require this much throughput headroom
const MIN_START_LEAD = 5;         // seconds buffered before first start
const REBUFFER_LEAD = 8;          // seconds buffered before resuming a hold
const GATE_TICK_MS = 250;
const THROUGHPUT_ALPHA = 0.3;     // EMA weight for new rate samples
const THROUGHPUT_SAMPLE_MS = 250;
const FETCH_RETRY_LIMIT = 3;
const FETCH_RETRY_DELAY_MS = 1000;

function mimeForTrack(track) {
  return track?.format === 'wav' ? 'audio/wav' : MSE_MIME;
}

// MediaSource on most browsers; ManagedMediaSource on iOS Safari 17.1+.
function mediaSourceClass() {
  for (const cls of [window.MediaSource, window.ManagedMediaSource]) {
    if (cls && typeof cls.isTypeSupported === 'function' && cls.isTypeSupported(MSE_MIME)) {
      return cls;
    }
  }
  return null;
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

function bufferedAheadSeconds(element, position) {
  const buffered = element.buffered;
  if (!buffered || !buffered.length) return 0;
  for (let i = 0; i < buffered.length; i += 1) {
    if (buffered.start(i) <= position + 0.3 && buffered.end(i) > position) {
      return buffered.end(i) - position;
    }
  }
  return 0;
}

function slowConnection() {
  const type = navigator.connection?.effectiveType || '';
  return navigator.connection?.saveData || type.includes('2g');
}

export function createTrackLoader({ onState, onProgress, onFilled } = {}) {
  const MediaSourceCls = mediaSourceClass();
  const memoryBlobs = new Map(); // trackId -> { url, size }
  const prefetchControllers = new Set();
  let session = null;
  let prefetchInFlight = 0;
  let warmupQueue = [];
  let warmupRunning = false;
  let warmupController = null;

  function emit(callback, ...args) {
    try {
      callback?.(...args);
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

  function teardown() {
    if (!session) return;
    const previous = session;
    session = null;
    previous.disposed = true;
    if (previous.gateTimer) window.clearInterval(previous.gateTimer);
    try {
      previous.abortController?.abort();
    } catch {
      // AbortController may already be settled.
    }
    try {
      previous.cleanup?.();
    } catch {
      // Element listeners may already be gone.
    }
    if (previous.objectUrl) {
      try {
        URL.revokeObjectURL(previous.objectUrl);
      } catch {
        // Already revoked.
      }
    }
    // Release anything still awaiting the start gate.
    previous.resolveAttach?.({ source: 'aborted' });
    previous.resolveAttach = null;
  }

  function newSession(element, track) {
    return {
      element,
      track,
      abortController: null,
      cleanup: null,
      objectUrl: null,
      activeUrl: null,
      disposed: false,
      fillDone: false,
      gateOpened: false,
      gatePaused: false,
      gateTimer: 0,
      resolveAttach: null,
      receivedBytes: 0,
      totalBytes: Number(track.sizeBytes) || 0,
      throughput: 0, // bytes/sec EMA
      sampleBytes: 0,
      sampleStart: 0,
      lastChunkAt: 0,
    };
  }

  function noteChunk(localSession, byteLength) {
    const now = performance.now();
    localSession.receivedBytes += byteLength;
    localSession.lastChunkAt = now;
    if (!localSession.sampleStart) {
      localSession.sampleStart = now;
      localSession.sampleBytes = byteLength;
      return;
    }
    localSession.sampleBytes += byteLength;
    const elapsed = now - localSession.sampleStart;
    if (elapsed >= THROUGHPUT_SAMPLE_MS) {
      const rate = (localSession.sampleBytes / elapsed) * 1000;
      localSession.throughput = localSession.throughput
        ? localSession.throughput * (1 - THROUGHPUT_ALPHA) + rate * THROUGHPUT_ALPHA
        : rate;
      localSession.sampleStart = now;
      localSession.sampleBytes = 0;
    }
    emit(onProgress, localSession.track, {
      receivedBytes: localSession.receivedBytes,
      totalBytes: localSession.totalBytes,
      fraction: localSession.totalBytes
        ? Math.min(1, localSession.receivedBytes / localSession.totalBytes)
        : 0,
    });
  }

  // Throughput estimate, decayed while no bytes are arriving so the gate
  // stays closed during a network dropout instead of trusting a stale rate.
  function effectiveThroughput(localSession) {
    const rate = localSession.throughput;
    if (!rate) return 0;
    const sinceChunk = performance.now() - (localSession.lastChunkAt || 0);
    if (sinceChunk <= 3000) return rate;
    return rate * (3000 / sinceChunk);
  }

  function gateSatisfied(localSession, leadSeconds) {
    if (localSession.fillDone) return true;

    const { element, track } = localSession;
    const duration = Number(track.durationSeconds)
      || (Number.isFinite(element.duration) ? element.duration : 0);
    const position = element.currentTime || 0;
    const ahead = bufferedAheadSeconds(element, position);
    const playTimeLeft = Math.max(0, duration - position);

    // Never demand more cushion than the track has left.
    const requiredLead = duration
      ? Math.min(leadSeconds, Math.max(0.5, playTimeLeft - 0.25))
      : leadSeconds;
    if (ahead < requiredLead) return false;
    if (!duration) return true;

    const rate = effectiveThroughput(localSession);
    if (!rate) return false;
    const remainingBytes = Math.max(0, localSession.totalBytes - localSession.receivedBytes);
    const downloadTimeLeft = remainingBytes / rate;
    return downloadTimeLeft * SAFETY <= playTimeLeft;
  }

  function openGate(localSession) {
    if (localSession.disposed || localSession.gateOpened) return;
    localSession.gateOpened = true;
    if (localSession.gateTimer) {
      window.clearInterval(localSession.gateTimer);
      localSession.gateTimer = 0;
    }
    emit(onState, localSession.track, 'streaming');
    localSession.resolveAttach?.({ source: 'mse' });
    localSession.resolveAttach = null;
  }

  function finishFill(localSession) {
    localSession.fillDone = true;
    emit(onProgress, localSession.track, {
      receivedBytes: localSession.totalBytes || localSession.receivedBytes,
      totalBytes: localSession.totalBytes,
      fraction: 1,
    });
    emit(onFilled, localSession.track);
  }

  // Hold playback after a mid-play underrun until the cushion is rebuilt.
  function holdForRebuffer(localSession) {
    const { element, track } = localSession;
    if (localSession.disposed || localSession.gatePaused || localSession.fillDone) return;
    // Transient waiting with data still buffered (e.g. a seek) is not an underrun.
    if (bufferedAheadSeconds(element, element.currentTime || 0) >= 1) return;

    localSession.gatePaused = true;
    element.pause();
    emit(onState, track, 'rebuffering');

    const timer = window.setInterval(() => {
      if (localSession.disposed || !localSession.gatePaused) {
        window.clearInterval(timer);
        return;
      }
      if (!gateSatisfied(localSession, REBUFFER_LEAD)) return;
      window.clearInterval(timer);
      localSession.gatePaused = false;
      element.play().then(() => {
        emit(onState, track, 'streaming');
      }).catch(() => {
        // Autoplay was blocked on resume; surface a normal paused state.
        emit(onState, track, 'suspended');
      });
    }, GATE_TICK_MS);
  }

  // Single fetch loop shared by the MSE and blob paths. Network errors resume
  // with Range requests from the last received byte.
  async function pumpDownload(localSession, onChunk) {
    const { track } = localSession;
    let retries = 0;

    for (;;) {
      try {
        const headers = localSession.receivedBytes
          ? { Range: `bytes=${localSession.receivedBytes}-` }
          : undefined;
        const response = await fetch(track.url, {
          signal: localSession.abortController.signal,
          cache: localSession.receivedBytes ? 'default' : 'force-cache',
          headers,
        });
        if (!response.ok || !response.body) throw new Error(`fetch ${response.status}`);
        // A 200 to a Range request means the server restarted from byte zero.
        if (localSession.receivedBytes && response.status === 200) {
          throw new Error('range ignored');
        }

        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return true;
          if (localSession.disposed) return false;
          noteChunk(localSession, value.length);
          onChunk(value);
        }
      } catch (error) {
        if (localSession.disposed || localSession.abortController.signal.aborted) return false;
        retries += 1;
        if (retries > FETCH_RETRY_LIMIT || error?.message === 'range ignored') throw error;
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS * retries));
      }
    }
  }

  function streamViaMse(element, track, localSession) {
    return new Promise((resolve, reject) => {
      let sourceBuffer = null;
      let streamDone = false;
      const queue = [];
      const chunks = [];

      const mediaSource = new MediaSourceCls();
      localSession.objectUrl = URL.createObjectURL(mediaSource);
      localSession.activeUrl = localSession.objectUrl;
      localSession.abortController = new AbortController();
      localSession.resolveAttach = resolve;
      // forceStart() may have opened the gate before this promise was wired up.
      if (localSession.gateOpened) {
        localSession.resolveAttach = null;
        resolve({ source: 'mse' });
      }

      const pump = () => {
        if (!sourceBuffer || sourceBuffer.updating || localSession.disposed) return;
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

      const checkGate = () => {
        if (!localSession.gateOpened && gateSatisfied(localSession, MIN_START_LEAD)) {
          openGate(localSession);
        }
      };

      const onWaiting = () => {
        if (localSession.gateOpened) holdForRebuffer(localSession);
      };
      element.addEventListener('waiting', onWaiting);
      localSession.cleanup = () => element.removeEventListener('waiting', onWaiting);

      mediaSource.addEventListener('sourceopen', async () => {
        if (localSession.disposed) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(MSE_MIME);
        } catch (error) {
          localSession.resolveAttach = null;
          reject(error);
          return;
        }

        // Give the element a finite duration right away: mpeg byte streams
        // otherwise report Infinity until endOfStream, which breaks seek math.
        const knownDuration = Number(track.durationSeconds);
        if (Number.isFinite(knownDuration) && knownDuration > 0) {
          try {
            mediaSource.duration = knownDuration;
          } catch {
            // Non-fatal; the UI falls back to the catalog duration.
          }
        }

        sourceBuffer.addEventListener('updateend', () => {
          checkGate();
          pump();
        });

        // The gate also needs ticks between appends: buffered time grows as the
        // element parses, and the playhead moves while a track plays.
        localSession.gateTimer = window.setInterval(checkGate, GATE_TICK_MS);

        try {
          const completed = await pumpDownload(localSession, (value) => {
            chunks.push(value);
            queue.push(value);
            pump();
          });
          if (!completed || localSession.disposed) return;

          streamDone = true;
          pump();

          const blob = new Blob(chunks, { type: MSE_MIME });
          rememberBlob(track, blob);
          cachePut(track.url, blob, MSE_MIME);
          finishFill(localSession);
          checkGate();
        } catch (error) {
          if (localSession.disposed) return;
          if (localSession.gateOpened) {
            // Already audible: keep what buffered instead of restarting.
            streamDone = true;
            pump();
            console.error('yng-music: download failed mid-stream; playback limited to buffered range.', error);
          } else {
            localSession.resolveAttach = null;
            reject(error);
          }
        }
      });

      if (window.ManagedMediaSource && mediaSource instanceof window.ManagedMediaSource) {
        // ManagedMediaSource refuses to open while remote playback is possible.
        element.disableRemotePlayback = true;
      }
      element.src = localSession.objectUrl;
      try {
        element.load();
      } catch {
        // Some browsers reload implicitly; safe to ignore.
      }
    });
  }

  // No MSE for this track (WAV, or an old browser): download fully with
  // progress, then play from a local blob. Trades startup wait for playback
  // that cannot stall.
  async function downloadToBlob(element, track, localSession) {
    localSession.abortController = new AbortController();
    // Restart the byte counters: an aborted MSE attempt may have consumed part
    // of the stream, and this path needs the file from byte zero.
    localSession.receivedBytes = 0;
    localSession.throughput = 0;
    localSession.sampleBytes = 0;
    localSession.sampleStart = 0;
    const chunks = [];
    const completed = await pumpDownload(localSession, value => chunks.push(value));
    if (!completed || localSession.disposed) return { source: 'aborted' };

    const mime = mimeForTrack(track);
    const blob = new Blob(chunks, { type: mime });
    const url = rememberBlob(track, blob);
    cachePut(track.url, blob, mime);
    element.src = url;
    localSession.activeUrl = url;
    localSession.gateOpened = true;
    finishFill(localSession);
    emit(onState, track, 'streaming');
    return { source: 'blob' };
  }

  async function attach(element, track) {
    teardown();
    // A real play takes priority: abort warmup and prefetch downloads in flight.
    pauseWarmup();
    abortPrefetches();
    const localSession = newSession(element, track);
    session = localSession;

    // 1. In-memory blob — instant.
    const remembered = memoryBlobs.get(track.id);
    if (remembered) {
      memoryBlobs.delete(track.id);
      memoryBlobs.set(track.id, remembered);
      element.src = remembered.url;
      localSession.activeUrl = remembered.url;
      localSession.fillDone = true;
      localSession.gateOpened = true;
      emit(onState, track, 'cached');
      emit(onFilled, track);
      return { source: 'memory' };
    }

    // 2. Persistent Cache API blob — instant across reloads / offline.
    const cachedBlob = await cacheMatch(track.url);
    if (localSession.disposed) return { source: 'aborted' };
    if (cachedBlob?.size) {
      const url = rememberBlob(track, cachedBlob);
      element.src = url;
      localSession.activeUrl = url;
      localSession.fillDone = true;
      localSession.gateOpened = true;
      emit(onState, track, 'cached');
      emit(onFilled, track);
      return { source: 'cache' };
    }

    emit(onState, track, 'buffering');

    // 3. Gated MSE streaming — one fetch feeds the SourceBuffer; playback is
    //    released once the buffer-ahead gate opens.
    if (MediaSourceCls && track.format !== 'wav') {
      try {
        const result = await streamViaMse(element, track, localSession);
        if (localSession.disposed) return { source: 'aborted' };
        return result;
      } catch (error) {
        if (localSession.disposed) return { source: 'aborted' };
        console.error('yng-music: MSE streaming failed, falling back to full download.', error);
        if (localSession.gateTimer) {
          window.clearInterval(localSession.gateTimer);
          localSession.gateTimer = 0;
        }
        if (localSession.objectUrl) {
          URL.revokeObjectURL(localSession.objectUrl);
          localSession.objectUrl = null;
        }
      }
    }

    // 4. Full download, then play from a blob.
    try {
      return await downloadToBlob(element, track, localSession);
    } catch (error) {
      if (localSession.disposed) return { source: 'aborted' };
      console.error('yng-music: download failed, falling back to native streaming.', error);
    }

    // 5. Bare native src — last resort, identical to the original behaviour.
    element.src = track.url;
    localSession.activeUrl = track.url;
    localSession.fillDone = true;
    localSession.gateOpened = true;
    emit(onState, track, 'native');
    return { source: 'native' };
  }

  // True while the loader is intentionally holding playback mid-play.
  function isGatePaused() {
    return Boolean(session && session.gatePaused);
  }

  // True while a start gate is still holding the pending attach().
  function isGateWaiting() {
    return Boolean(session && !session.disposed && !session.gateOpened);
  }

  // The listener insists (clicked play during a hold): start with whatever is
  // buffered right now. Blob downloads cannot start early — there is no
  // playable partial data — so only MSE start gates and mid-play holds react.
  function forceStart() {
    if (!session || session.disposed) return false;
    if (!session.gateOpened && session.resolveAttach) {
      openGate(session);
      return true;
    }
    if (session.gatePaused) {
      session.gatePaused = false;
      session.element.play().catch(() => {
        emit(onState, session.track, 'suspended');
      });
      return true;
    }
    return false;
  }

  async function prefetch(track, { force = false, signal = null } = {}) {
    if (!track?.url) return false;
    if (!force && prefetchInFlight > 0) return false; // One background download at a time.
    if (memoryBlobs.has(track.id)) return true;
    if (await cacheHas(track.url)) return true;

    // Track our own controller so attach() can cancel background downloads
    // the moment a real play starts competing for bandwidth.
    const controller = signal ? null : new AbortController();
    if (controller) prefetchControllers.add(controller);
    prefetchInFlight += 1;
    try {
      const response = await fetch(track.url, {
        cache: 'force-cache',
        signal: signal || controller.signal,
      });
      if (!response.ok) return false;
      const blob = await response.blob();
      await cachePut(track.url, blob, mimeForTrack(track));
      return true;
    } catch {
      // Prefetch is best-effort.
      return false;
    } finally {
      if (controller) prefetchControllers.delete(controller);
      prefetchInFlight -= 1;
    }
  }

  function abortPrefetches() {
    for (const controller of prefetchControllers) {
      try {
        controller.abort();
      } catch {
        // Already settled.
      }
    }
    prefetchControllers.clear();
  }

  function loaderIdle() {
    return !session || session.fillDone || session.disposed;
  }

  // Sequentially pre-fill the given tracks (typically the first few visible)
  // so clicking the top of the list plays instantly. Defers to any foreground
  // load: attach() aborts the in-flight warmup fetch, and the queue resumes
  // the same track once the foreground stream has finished filling.
  async function warmup(tracks) {
    if (slowConnection()) return;
    warmupQueue = tracks.filter(Boolean);
    if (warmupRunning) return;
    warmupRunning = true;
    try {
      while (warmupQueue.length) {
        while (!loaderIdle()) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const track = warmupQueue[0];
        warmupController = new AbortController();
        const done = await prefetch(track, { force: true, signal: warmupController.signal });
        warmupController = null;
        if (done || loaderIdle()) warmupQueue.shift();
      }
    } finally {
      warmupRunning = false;
      warmupController = null;
    }
  }

  function pauseWarmup() {
    try {
      warmupController?.abort();
    } catch {
      // Already settled.
    }
  }

  return { attach, prefetch, warmup, teardown, isGatePaused, isGateWaiting, forceStart };
}
