import './styles/music-page.css';
import { createTrackLoader } from './js/audio/track-loader.js';

const list = document.getElementById('music-list');
const search = document.getElementById('music-search');
const sort = document.getElementById('music-sort');
const favoritesFilter = document.getElementById('music-favorites-filter');
const count = document.getElementById('music-count');
const summary = document.getElementById('music-summary');
const playerToggle = document.getElementById('music-player-toggle');
const playerShuffle = document.getElementById('music-player-shuffle');
const playerTitle = document.getElementById('music-player-title');
const playerMeta = document.getElementById('music-player-meta');
const playerCurrent = document.getElementById('music-player-current');
const playerDuration = document.getElementById('music-player-duration');
const playerProgress = document.getElementById('music-player-progress');
const visualizer = document.getElementById('music-visualizer');
const spectrogramCanvas = document.getElementById('music-spectrogram-canvas');
const scopeCanvas = document.getElementById('music-scope-canvas');
const spectrumCanvas = document.getElementById('music-spectrum-canvas');
const upload = document.getElementById('music-upload');
const uploadInput = document.getElementById('music-upload-input');
const uploadButton = document.getElementById('music-upload-button');
const uploadStatus = document.getElementById('music-upload-status');
const uploadProgressBar = document.getElementById('music-upload-progress-bar');

let tracks = [];
let visibleTracks = tracks;
let trackGroups = [];
let visibleGroups = [];
let trackNumbers = new Map();
let trackById = new Map();
let groupByTrackId = new Map();
let pendingUploadGroup = null;
let showFavoritesOnly = false;
const expandedGroups = new Set();
const collapsedGroups = new Set();
const audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'none';
playerProgress.style.setProperty('--player-progress', '0%');

const VISUALIZER_ACTIVE_FRAME_MS = 33;
const VISUALIZER_IDLE_FRAME_MS = 80;
const VISUALIZER_DPR_LIMIT = 2;
const SPECTRUM_CELLS = 84;
const INITIAL_GROUP_RENDER_COUNT = 56;
const GROUP_RENDER_CHUNK_SIZE = 32;
const FAVORITES_STORAGE_KEY = 'yngMusicFavoriteTracks';

const UPLOAD_CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
};

let currentTrack = null;
let previousActiveTrackId = null;
let playToken = 0;
let isBuffering = false;
let isSeeking = false;
let isUploading = false;
let uploadDragDepth = 0;
let audioContext = null;
let audioSourceNode = null;
let analyserNode = null;
let visualizerRaf = 0;
let visualizerLastFrame = 0;
let visualizerError = '';
let visualizerInView = true;
let visualizerNeedsResize = true;
let visualizerStateKey = '';
let renderRevision = 0;
let catalogLoaded = false;
let searchRenderRaf = 0;

const visualizerContexts = {
  spectrogram: spectrogramCanvas?.getContext('2d', { alpha: false }),
  scope: scopeCanvas?.getContext('2d', { alpha: false }),
  spectrum: spectrumCanvas?.getContext('2d', { alpha: false }),
};

const visualizerSizes = {
  spectrogram: {},
  scope: {},
  spectrum: {},
};

const visualizerBuffers = {
  freq: null,
  time: null,
  timeByte: null,
};

const spectrumMotion = {
  raw: new Float32Array(SPECTRUM_CELLS).fill(0.06),
  smoothed: new Float32Array(SPECTRUM_CELLS).fill(0.06),
  positions: new Float32Array(SPECTRUM_CELLS).fill(0.06),
  previous: new Float32Array(SPECTRUM_CELLS).fill(0.06),
  lastTimestamp: 0,
};

let trackMetaById = new Map();
let trackSearchTextById = new Map();

const favoriteTrackIds = new Set(readFavoriteTrackIds());

const trackLoader = createTrackLoader({
  onState: (track, state) => {
    if (track?.id !== currentTrack?.id) return;
    setBuffering(state === 'buffering');
  },
  onProgress: (track, info) => {
    if (track?.id !== currentTrack?.id) return;
    updateDownloadProgress(info.fraction);
  },
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function currentSortMode() {
  return sort?.value || 'newest';
}

function trackUploadedTimestamp(track) {
  const timestamp = Date.parse(track.uploadedAt || track.modifiedAt || track.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareTrackTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
    || String(a.fileName || '').localeCompare(String(b.fileName || ''), undefined, { sensitivity: 'base' })
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function sortTracks(nextTracks) {
  const mode = currentSortMode();
  return [...nextTracks].sort((a, b) => {
    if (mode === 'title') return compareTrackTitle(a, b);

    const dateDelta = mode === 'oldest'
      ? trackUploadedTimestamp(a) - trackUploadedTimestamp(b)
      : trackUploadedTimestamp(b) - trackUploadedTimestamp(a);
    return dateDelta || compareTrackTitle(a, b);
  });
}

function rebuildTrackNumbers() {
  trackNumbers = new Map(tracks.map((track, index) => [track.id, String(index + 1).padStart(3, '0')]));
  trackById = new Map(tracks.map(track => [track.id, track]));
  trackMetaById = new Map(tracks.map(track => [track.id, buildTrackMeta(track)]));
  trackSearchTextById = new Map(tracks.map(track => [track.id, [
    track.title,
    track.fileName,
    track.groupTitle,
  ].filter(Boolean).join(' ').toLowerCase()]));
  trackGroups = buildTrackGroups(tracks);
  groupByTrackId = new Map(trackGroups.flatMap(group => group.tracks.map(track => [track.id, group])));
}

function normalizeGroupText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function similarTrackKey(track) {
  const rawTitle = track.groupTitle || track.title || track.fileName || '';
  const withoutExtension = String(rawTitle).replace(/\.[a-z0-9]+$/i, '');
  let base = withoutExtension
    .replace(/\s*\[[^\]]+\]\s*$/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+-\s*(?:alt|bounce|copy|export|final|master|mix|take|version|v)\s*\d*$/i, '');

  base = normalizeGroupText(base);
  if (/\p{L}/u.test(base)) {
    base = normalizeGroupText(base.replace(/\s*(?:alt|copy|final|master|mix|take|version|v)?\s*\d+$/i, ''));
  }

  return base.length >= 2 ? base : normalizeGroupText(withoutExtension);
}

function primaryTrackForGroup(groupTracks) {
  return [...groupTracks].sort((a, b) => (
    Number(Boolean(a.groupTitle)) - Number(Boolean(b.groupTitle))
    || a.title.length - b.title.length
    || a.title.localeCompare(b.title)
  ))[0];
}

function buildTrackGroups(nextTracks) {
  const groupsByKey = new Map();

  for (const track of nextTracks) {
    const key = similarTrackKey(track);
    groupsByKey.set(key, [...(groupsByKey.get(key) || []), track]);
  }

  return [...groupsByKey.entries()]
    .map(([key, groupTracks]) => {
      const groupTracksSorted = sortTracks(groupTracks);
      const primary = primaryTrackForGroup(groupTracksSorted);
      return {
        id: key,
        key,
        primary,
        tracks: [
          primary,
          ...groupTracksSorted.filter(track => track.id !== primary.id),
        ],
      };
    })
    .sort(compareTrackGroups);
}

function groupUploadedTimestamp(group) {
  const timestamps = group.tracks.map(trackUploadedTimestamp);
  return currentSortMode() === 'oldest' ? Math.min(...timestamps) : Math.max(...timestamps);
}

function compareTrackGroups(a, b) {
  const mode = currentSortMode();
  if (mode === 'title') return compareTrackTitle(a.primary, b.primary);

  const dateDelta = mode === 'oldest'
    ? groupUploadedTimestamp(a) - groupUploadedTimestamp(b)
    : groupUploadedTimestamp(b) - groupUploadedTimestamp(a);
  return dateDelta || compareTrackTitle(a.primary, b.primary);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function trackDurationSeconds(track) {
  const seconds = Number(track?.durationSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function totalTrackDuration(nextTracks) {
  return nextTracks.reduce((sum, track) => sum + trackDurationSeconds(track), 0);
}

function formatDurationSummary(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';

  const rounded = Math.max(1, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return remainingSeconds && minutes < 10 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  return `${remainingSeconds}s`;
}

function setArchiveSummary() {
  const totalDuration = formatDurationSummary(totalTrackDuration(tracks));
  summary.textContent = `${tracks.length} exported tracks${totalDuration ? ` · ${totalDuration} total` : ''}.`;
}

function formatUploadedDate(track) {
  const timestamp = trackUploadedTimestamp(track);
  return timestamp ? dateFormatter.format(new Date(timestamp)) : '';
}

function buildTrackMeta(track) {
  return [
    track.format.toUpperCase(),
    formatUploadedDate(track),
    track.duration,
    formatBytes(track.sizeBytes),
  ].filter(Boolean).join(' / ');
}

function trackMeta(track) {
  return trackMetaById.get(track.id) || buildTrackMeta(track);
}

function activeTrackMeta(track) {
  const duration = audio.duration || track.durationSeconds || 0;
  return [
    track.format.toUpperCase(),
    formatUploadedDate(track),
    `${formatClock(audio.currentTime)} / ${formatClock(duration)}`,
    formatBytes(track.sizeBytes),
  ].filter(Boolean).join(' / ');
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function readFavoriteTrackIds() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function persistFavoriteTrackIds() {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteTrackIds]));
}

function isFavoriteTrack(trackId) {
  return favoriteTrackIds.has(String(trackId || ''));
}

function setFavoriteTrack(trackId, isFavorite) {
  const id = String(trackId || '');
  if (!id) return;
  if (isFavorite) favoriteTrackIds.add(id);
  else favoriteTrackIds.delete(id);
  persistFavoriteTrackIds();
  syncFavoriteButtons(id);
}

function syncFavoriteButtons(trackId) {
  list.querySelectorAll(`.music-track-favorite[data-track-id="${CSS.escape(trackId)}"]`).forEach((button) => {
    const isFavorite = isFavoriteTrack(trackId);
    button.classList.toggle('is-favorite', isFavorite);
    button.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
    button.title = isFavorite ? 'Remove favorite' : 'Favorite track';
    button.setAttribute('aria-label', `${isFavorite ? 'Remove favorite' : 'Favorite'} ${trackById.get(trackId)?.title || 'track'}`);
  });
}

function syncVisualizerCanvas(canvas, ctx, sizeRef, shouldMeasure) {
  if (!shouldMeasure && sizeRef.width && sizeRef.height) {
    return { width: sizeRef.width, height: sizeRef.height, resized: false };
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, VISUALIZER_DPR_LIMIT);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const resized = (
    sizeRef.width !== width
    || sizeRef.height !== height
    || sizeRef.dpr !== dpr
  );

  if (resized) {
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    sizeRef.width = width;
    sizeRef.height = height;
    sizeRef.dpr = dpr;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (resized) ctx.clearRect(0, 0, width, height);
  return { width, height, resized };
}

function readTimeDomain(analyser, floatBuffer, byteBuffer) {
  if (analyser.getFloatTimeDomainData) {
    analyser.getFloatTimeDomainData(floatBuffer);
    return floatBuffer;
  }

  analyser.getByteTimeDomainData(byteBuffer);
  for (let i = 0; i < byteBuffer.length; i += 1) {
    floatBuffer[i] = (byteBuffer[i] - 128) / 128;
  }
  return floatBuffer;
}

function frequencyBandValue(freqData, fromRatio, toRatio) {
  if (!freqData?.length) return 0;

  const start = Math.max(1, Math.floor(freqData.length * fromRatio));
  const end = Math.max(start + 1, Math.floor(freqData.length * toRatio));
  let sum = 0;
  for (let index = start; index < Math.min(end, freqData.length); index += 1) {
    sum += freqData[index] / 255;
  }
  return clamp(sum / Math.max(1, end - start));
}

function drawVisualizerGrid(ctx, width, height, accent = 0) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `rgba(${12 + accent * 26}, ${15 + accent * 18}, ${14 + accent * 8}, 0.96)`);
  gradient.addColorStop(1, 'rgba(4, 5, 5, 0.96)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = `rgba(255, 255, 240, ${0.045 + accent * 0.045})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const verticalStep = Math.max(32, width / 6);
  for (let x = 0; x <= width; x += verticalStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  const horizontalStep = Math.max(24, height / 4);
  for (let y = 0; y <= height; y += horizontalStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawIdleSpectrogram(ctx, canvas, width, height, timestamp) {
  ctx.drawImage(canvas, -1, 0, width, height);
  const drift = (Math.sin(timestamp / 900) + 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const tone = (Math.sin(y * 0.08 + timestamp / 700) + 1) / 2;
    const value = 0.04 + tone * 0.08 + drift * 0.035;
    ctx.fillStyle = `rgba(${42 + value * 160}, ${62 + value * 210}, ${70 + value * 160}, ${0.12 + value})`;
    ctx.fillRect(width - 1, y, 1, 1);
  }
}

function drawSpectrogram(ctx, canvas, freqData, width, height, energy) {
  ctx.drawImage(canvas, -1, 0, width, height);
  const maxIndex = freqData.length - 1;
  for (let y = 0; y < height; y += 1) {
    const ratio = 1 - (y / Math.max(1, height - 1));
    const curved = ratio * ratio * ratio;
    const index = Math.min(maxIndex, Math.floor(curved * maxIndex));
    const value = Math.pow(freqData[index] / 255, 1.16);
    const hue = 190 - value * 145 + energy * 22;
    const light = 9 + value * 64;
    const alpha = 0.22 + value * 0.78;
    ctx.fillStyle = `hsla(${hue}, 92%, ${light}%, ${alpha})`;
    ctx.fillRect(width - 1, y, 1, 1);
  }
}

function drawScope(ctx, data, width, height, energy, timestamp, isLive) {
  drawVisualizerGrid(ctx, width, height, energy);

  const mid = height * 0.52;
  ctx.strokeStyle = 'rgba(255, 255, 240, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  const sampleCount = data?.length || 192;
  const step = Math.max(1, Math.floor(sampleCount / Math.max(120, width)));
  const amplitude = isLive ? 0.84 : 0.18;
  ctx.lineWidth = isLive ? 1.65 : 1.2;
  ctx.strokeStyle = isLive ? 'rgba(255, 241, 190, 0.92)' : 'rgba(255, 255, 240, 0.32)';
  ctx.shadowColor = isLive ? 'rgba(116, 240, 210, 0.48)' : 'rgba(255, 255, 240, 0.12)';
  ctx.shadowBlur = isLive ? 12 + energy * 18 : 5;
  ctx.beginPath();

  for (let i = 0; i < sampleCount; i += step) {
    const sample = isLive
      ? data[i]
      : Math.sin((i / sampleCount) * Math.PI * 4 + timestamp / 620) * 0.32;
    const x = (i / Math.max(1, sampleCount - 1)) * width;
    const y = mid - sample * height * amplitude * 0.42;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

function sampleLogSpectrum(freqData, timestamp, isLive) {
  const { raw, smoothed } = spectrumMotion;

  if (!isLive || !freqData?.length) {
    for (let index = 0; index < raw.length; index += 1) {
      const position = index / Math.max(1, raw.length - 1);
      const firstWave = Math.max(0, Math.sin(index * 0.38 + timestamp / 520));
      const secondWave = Math.max(0, Math.sin(index * 0.13 - timestamp / 880));
      raw[index] = 0.055 + firstWave * 0.085 + secondWave * 0.045 + position * 0.015;
      smoothed[index] += (raw[index] - smoothed[index]) * 0.12;
    }
    return;
  }

  const sampleRate = audioContext?.sampleRate || 48000;
  const fftSize = analyserNode?.fftSize || freqData.length * 2;
  const hzPerBin = sampleRate / fftSize;
  const minFrequency = 28;
  const maxFrequency = Math.min(18000, sampleRate * 0.48);
  const frequencyRatio = maxFrequency / minFrequency;

  for (let index = 0; index < raw.length; index += 1) {
    const startFrequency = minFrequency * frequencyRatio ** (index / raw.length);
    const endFrequency = minFrequency * frequencyRatio ** ((index + 1) / raw.length);
    const startBin = Math.max(1, Math.floor(startFrequency / hzPerBin));
    const endBin = Math.max(startBin + 1, Math.ceil(endFrequency / hzPerBin));
    let peak = 0;

    for (let bin = startBin; bin < Math.min(endBin, freqData.length); bin += 1) {
      peak = Math.max(peak, freqData[bin]);
    }

    const next = Math.pow(peak / 255, 1.18);
    raw[index] = next;
    const response = next > smoothed[index] ? 0.58 : 0.13;
    smoothed[index] += (next - smoothed[index]) * response;
  }
}

function stepSpectrumString(timestamp) {
  const state = spectrumMotion;
  const elapsed = state.lastTimestamp ? (timestamp - state.lastTimestamp) / 1000 : 0.033;
  const total = clamp(elapsed, 0.008, 0.06);
  state.lastTimestamp = timestamp;
  const substeps = Math.max(1, Math.min(3, Math.ceil(total / 0.018)));
  const step = total / substeps;
  const stepSquared = step * step;

  for (let pass = 0; pass < substeps; pass += 1) {
    for (let index = 0; index < state.positions.length; index += 1) {
      const position = state.positions[index];
      const left = state.positions[index > 0 ? index - 1 : index];
      const right = state.positions[index < state.positions.length - 1 ? index + 1 : index];
      const acceleration = (
        118 * (state.smoothed[index] - position)
        + 260 * (left + right - 2 * position)
      );
      const next = position + (position - state.previous[index]) * 0.88 + acceleration * stepSquared;
      state.previous[index] = position;
      state.positions[index] = Number.isFinite(next) ? clamp(next, 0, 1.08) : state.smoothed[index];
    }
  }
}

function traceSpectrum(ctx, values, width, height) {
  const baseline = height - 1;
  ctx.beginPath();
  for (let index = 0; index < values.length; index += 1) {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const value = clamp(values[index]);
    const y = baseline - value * height * 0.82;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawSpectrum(ctx, freqData, width, height, energy, timestamp, isLive) {
  sampleLogSpectrum(freqData, timestamp, isLive);
  stepSpectrumString(timestamp);

  ctx.fillStyle = '#1d2021';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(235, 219, 178, 0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const frequency of [100, 1000, 10000]) {
    const x = (Math.log(frequency / 28) / Math.log(18000 / 28)) * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (const level of [0.25, 0.5, 0.75]) {
    const y = height - level * height;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  traceSpectrum(ctx, spectrumMotion.raw, width, height);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = `rgba(214, 93, 14, ${isLive ? 0.16 + energy * 0.12 : 0.08})`;
  ctx.fill();

  traceSpectrum(ctx, spectrumMotion.positions, width, height);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, `rgba(251, 73, 52, ${isLive ? 0.48 : 0.2})`);
  fill.addColorStop(0.58, `rgba(214, 93, 14, ${isLive ? 0.3 : 0.13})`);
  fill.addColorStop(1, 'rgba(214, 93, 14, 0.025)');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.save();
  ctx.shadowColor = `rgba(214, 93, 14, ${isLive ? 0.78 : 0.34})`;
  ctx.shadowBlur = isLive ? 7 + energy * 9 : 4;
  ctx.strokeStyle = isLive ? '#ebdbb2' : 'rgba(235, 219, 178, 0.56)';
  ctx.lineWidth = isLive ? 1.65 : 1.2;
  traceSpectrum(ctx, spectrumMotion.positions, width, height);
  ctx.stroke();
  ctx.restore();
}

function isVisualizerLive() {
  return Boolean(
    analyserNode
    && currentTrack
    && !audio.paused
    && !audio.ended
    && !visualizerError
    && document.visibilityState !== 'hidden'
  );
}

function updateVisualizerState(live = isVisualizerLive()) {
  if (!visualizer) return;

  let label = 'Idle';
  if (visualizerError) label = 'Offline';
  else if (live) label = 'Live';
  else if (currentTrack && audio.paused) label = 'Paused';
  else if (currentTrack) label = 'Ready';

  const stateKey = `${label}:${Boolean(currentTrack)}:${Boolean(visualizerError)}`;
  if (stateKey === visualizerStateKey) return;
  visualizerStateKey = stateKey;

  visualizer.classList.toggle('is-live', live);
  visualizer.classList.toggle('has-track', Boolean(currentTrack));
  visualizer.classList.toggle('is-offline', Boolean(visualizerError));
  visualizer.setAttribute('aria-label', `Audio visualizer: ${label}`);
}

function createAnalyser() {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -14;
  analyser.smoothingTimeConstant = 0.82;
  return analyser;
}

function connectVisualizerSource(sourceNode, mode) {
  analyserNode = createAnalyser();
  audioSourceNode = sourceNode;
  audioSourceNode.connect(analyserNode);

  if (mode === 'media-element') analyserNode.connect(audioContext.destination);
}

async function ensureVisualizerAudio() {
  if (!visualizer || visualizerError) return false;

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    visualizerError = 'Web Audio unavailable';
    updateVisualizerState(false);
    return false;
  }

  try {
    if (!audioContext) {
      audioContext = new AudioContextConstructor();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (analyserNode) return true;

    const captureStream = audio.captureStream || audio.mozCaptureStream;
    if (typeof captureStream === 'function') {
      const playbackStream = captureStream.call(audio);
      if (playbackStream?.getAudioTracks?.().length) {
        connectVisualizerSource(audioContext.createMediaStreamSource(playbackStream), 'playback-stream');
        return true;
      }
    }

    connectVisualizerSource(audioContext.createMediaElementSource(audio), 'media-element');
    return true;
  } catch {
    visualizerError = 'Analyzer unavailable';
    updateVisualizerState(false);
    return false;
  }
}

async function startVisualizerPlayback() {
  if (!currentTrack) return false;

  const canAnalyze = await ensureVisualizerAudio();
  updateVisualizerState();
  return canAnalyze;
}

function pauseVisualizerPlayback() {
  updateVisualizerState();
}

function drawVisualizerFrame(timestamp = 0) {
  if (!spectrogramCanvas || !scopeCanvas || !spectrumCanvas) return;

  const spectrogramCtx = visualizerContexts.spectrogram;
  const scopeCtx = visualizerContexts.scope;
  const spectrumCtx = visualizerContexts.spectrum;
  if (!spectrogramCtx || !scopeCtx || !spectrumCtx) return;

  const shouldMeasure = visualizerNeedsResize;
  const spectrogramSize = syncVisualizerCanvas(spectrogramCanvas, spectrogramCtx, visualizerSizes.spectrogram, shouldMeasure);
  const scopeSize = syncVisualizerCanvas(scopeCanvas, scopeCtx, visualizerSizes.scope, shouldMeasure);
  const spectrumSize = syncVisualizerCanvas(spectrumCanvas, spectrumCtx, visualizerSizes.spectrum, shouldMeasure);
  visualizerNeedsResize = false;
  const live = isVisualizerLive();
  updateVisualizerState(live);

  if (!live) {
    drawIdleSpectrogram(spectrogramCtx, spectrogramCanvas, spectrogramSize.width, spectrogramSize.height, timestamp);
    drawScope(scopeCtx, null, scopeSize.width, scopeSize.height, 0, timestamp, false);
    drawSpectrum(spectrumCtx, null, spectrumSize.width, spectrumSize.height, 0, timestamp, false);
    return;
  }

  if (!visualizerBuffers.freq || visualizerBuffers.freq.length !== analyserNode.frequencyBinCount) {
    visualizerBuffers.freq = new Uint8Array(analyserNode.frequencyBinCount);
  }
  if (!visualizerBuffers.time || visualizerBuffers.time.length !== analyserNode.fftSize) {
    visualizerBuffers.time = new Float32Array(analyserNode.fftSize);
    visualizerBuffers.timeByte = new Uint8Array(analyserNode.fftSize);
  }

  analyserNode.getByteFrequencyData(visualizerBuffers.freq);
  const timeData = readTimeDomain(analyserNode, visualizerBuffers.time, visualizerBuffers.timeByte);
  const lowEnergy = frequencyBandValue(visualizerBuffers.freq, 0.005, 0.08);
  const midEnergy = frequencyBandValue(visualizerBuffers.freq, 0.08, 0.34);
  const energy = clamp(lowEnergy * 0.75 + midEnergy * 0.25);

  drawSpectrogram(
    spectrogramCtx,
    spectrogramCanvas,
    visualizerBuffers.freq,
    spectrogramSize.width,
    spectrogramSize.height,
    energy,
  );
  drawScope(scopeCtx, timeData, scopeSize.width, scopeSize.height, energy, timestamp, true);
  drawSpectrum(spectrumCtx, visualizerBuffers.freq, spectrumSize.width, spectrumSize.height, energy, timestamp, true);
}

function shouldRunVisualizerLoop() {
  return document.visibilityState !== 'hidden' && visualizerInView;
}

function runVisualizerFrame(timestamp) {
  visualizerRaf = 0;
  if (!shouldRunVisualizerLoop()) return;

  const frameMs = isVisualizerLive() ? VISUALIZER_ACTIVE_FRAME_MS : VISUALIZER_IDLE_FRAME_MS;
  if (timestamp - visualizerLastFrame >= frameMs) {
    visualizerLastFrame = timestamp;
    drawVisualizerFrame(timestamp);
  }
  visualizerRaf = requestAnimationFrame(runVisualizerFrame);
}

function syncVisualizerLoop() {
  if (!shouldRunVisualizerLoop()) {
    if (visualizerRaf) cancelAnimationFrame(visualizerRaf);
    visualizerRaf = 0;
    return;
  }
  if (!visualizerRaf) visualizerRaf = requestAnimationFrame(runVisualizerFrame);
}

function startVisualizerLoop() {
  if (!visualizer) return;
  syncVisualizerLoop();

  document.addEventListener('visibilitychange', syncVisualizerLoop);
  window.addEventListener('resize', () => {
    visualizerNeedsResize = true;
    syncVisualizerLoop();
  }, { passive: true });

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      visualizerNeedsResize = true;
    }).observe(visualizer);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visualizerInView = entry.isIntersecting;
      syncVisualizerLoop();
    }, { rootMargin: '180px 0px' }).observe(visualizer);
  }
}

function setUploadStatus(message, progress = null) {
  uploadStatus.textContent = message;
  upload.classList.toggle('has-status', Boolean(message));
  upload.classList.toggle('has-progress', Number.isFinite(progress));
  if (uploadProgressBar) {
    const clamped = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
    uploadProgressBar.style.transform = `scaleX(${clamped})`;
  }
}

function groupLabel(group) {
  return group?.primary?.groupTitle || group?.primary?.title || 'group';
}

function groupElementId(group) {
  const slug = String(group.id || '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'group';
  return `music-group-${slug}-${group.primary.id}`;
}

function uploadFormat(fileName) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function isUploadableAudio(file) {
  return Object.hasOwn(UPLOAD_CONTENT_TYPES, uploadFormat(file.name));
}

function uploadContentType(file) {
  const format = uploadFormat(file.name);
  return file.type || UPLOAD_CONTENT_TYPES[format] || 'application/octet-stream';
}

function uploadKey() {
  const stored = window.localStorage.getItem('yngMusicUploadKey');
  if (stored) return stored;

  const value = window.prompt('Upload key');
  if (value) window.localStorage.setItem('yngMusicUploadKey', value);
  return value;
}

async function sha256File(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hashBuffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function durationFromFile(file) {
  return new Promise((resolve) => {
    const preview = new Audio();
    const url = URL.createObjectURL(file);
    preview.preload = 'metadata';
    preview.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(preview.duration || 0);
    };
    preview.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    preview.src = url;
  });
}

async function postUploadAction(body, key) {
  const response = await fetch('/api/music-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-yng-upload-key': key,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.localStorage.removeItem('yngMusicUploadKey');
    throw new Error(payload.error || 'Upload failed.');
  }
  return payload;
}

function applyCatalog(catalog) {
  if (!catalog?.tracks?.length) return;
  catalogLoaded = true;
  tracks = sortTracks(catalog.tracks);
  rebuildTrackNumbers();
  setArchiveSummary();
  render();
  updatePlayerText(currentTrack);
  syncActiveRows();
}

function putFileWithProgress(url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    Object.entries(headers || {}).forEach(([name, value]) => request.setRequestHeader(name, value));

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`S3 upload failed for ${file.name}.`));
    };
    request.onerror = () => reject(new Error(`S3 upload failed for ${file.name}.`));
    request.onabort = () => reject(new Error(`S3 upload cancelled for ${file.name}.`));
    request.send(file);
  });
}

async function uploadFile(file, key, index, total, group = null) {
  if (!isUploadableAudio(file)) {
    throw new Error(`${file.name} is not an MP3 or WAV file.`);
  }

  const groupTitle = group ? groupLabel(group) : '';
  const uploadLabel = groupTitle ? `Adding to ${groupTitle}` : 'Uploading';
  const stepBase = (index - 1) / total;
  const stepSize = 1 / total;
  const setStepStatus = (message, stepProgress) => {
    setUploadStatus(message, stepBase + (stepSize * stepProgress));
  };

  setStepStatus(`${uploadLabel}: hashing ${index} / ${total}`, 0.05);
  const [sha256, durationSeconds] = await Promise.all([
    sha256File(file),
    durationFromFile(file),
  ]);

  const base = {
    action: 'sign',
    fileName: file.name,
    contentType: uploadContentType(file),
    sizeBytes: file.size,
    sha256,
    durationSeconds,
    ...(groupTitle ? { groupTitle } : {}),
  };

  setStepStatus(`${uploadLabel}: signing ${index} / ${total}`, 0.18);
  const signed = await postUploadAction(base, key);

  setStepStatus(`${uploadLabel}: uploading ${index} / ${total} · 0%`, 0.2);
  await putFileWithProgress(signed.uploadUrl, signed.headers, file, (progress) => {
    setStepStatus(`${uploadLabel}: uploading ${index} / ${total} · ${Math.round(progress * 100)}%`, 0.2 + (progress * 0.62));
  });

  setStepStatus(`${uploadLabel}: saving ${index} / ${total}`, 0.9);
  const completed = await postUploadAction({ ...base, action: 'complete' }, key);
  if (group) {
    collapsedGroups.delete(group.id);
    expandedGroups.add(group.id);
  }
  applyCatalog(completed.catalog);
}

async function uploadFiles(fileList, group = null) {
  const files = [...fileList].filter(isUploadableAudio);
  if (isUploading) return;
  if (!files.length) {
    setUploadStatus('No MP3 or WAV files selected.');
    return;
  }

  const key = uploadKey();
  if (!key) return;

  isUploading = true;
  upload.classList.add('is-uploading');

  try {
    for (const [index, file] of files.entries()) {
      await uploadFile(file, key, index + 1, files.length, group);
    }
    setUploadStatus(group
      ? `Added ${files.length} track${files.length === 1 ? '' : 's'} to ${groupLabel(group)}.`
      : `Uploaded ${files.length} track${files.length === 1 ? '' : 's'}.`, 1);
  } catch (error) {
    setUploadStatus(error.message || 'Upload failed.');
  } finally {
    isUploading = false;
    pendingUploadGroup = null;
    upload.classList.remove('is-uploading', 'is-dragging');
    uploadInput.value = '';
  }
}

function renderTrack(track, options = {}) {
  const { group = null, variant = false } = options;
  const isActive = currentTrack?.id === track.id;
  const isFavorite = isFavoriteTrack(track.id);
  const item = document.createElement('div');
  item.className = variant ? 'music-archive-track music-track-variant' : 'music-archive-track';
  item.dataset.trackId = track.id;
  item.role = 'button';
  item.tabIndex = 0;
  item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  if (isActive) item.classList.add('is-active');

  const number = document.createElement('span');
  number.className = 'music-track-number';
  number.textContent = isActive ? (audio.paused ? 'Play' : 'Pause') : trackNumbers.get(track.id);

  const title = document.createElement('span');
  title.className = 'music-track-title';

  const titleText = document.createElement('span');
  titleText.className = 'music-track-title-text';
  titleText.textContent = track.title;
  title.append(titleText);

  if (group?.tracks.length > 1 && !variant) {
    const badge = document.createElement('span');
    badge.className = 'music-track-group-badge';
    badge.textContent = `${group.tracks.length} tracks`;
    title.append(badge);
  }

  const meta = document.createElement('p');
  meta.className = 'music-archive-meta';
  meta.textContent = isActive ? activeTrackMeta(track) : trackMeta(track);

  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.className = 'music-track-favorite';
  favorite.dataset.trackId = track.id;
  favorite.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
  favorite.setAttribute('aria-label', `${isFavorite ? 'Remove favorite' : 'Favorite'} ${track.title}`);
  favorite.title = isFavorite ? 'Remove favorite' : 'Favorite track';
  if (isFavorite) favorite.classList.add('is-favorite');
  favorite.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m12 3.6 2.6 5.2 5.8.8-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7-4.2-4.1 5.8-.8z"></path>
    </svg>
  `;

  item.append(number, title, meta, favorite);
  return item;
}

function renderGroup(group) {
  if (group.tracks.length === 1) return renderTrack(group.primary, { group });

  const isExpanded = isGroupExpanded(group);
  const wrapper = document.createElement('div');
  wrapper.className = `music-track-group has-variants${isExpanded ? ' is-expanded' : ' is-collapsed'}`;
  wrapper.dataset.groupId = group.id;

  const primaryRow = document.createElement('div');
  primaryRow.className = 'music-track-group-row';

  const actions = document.createElement('div');
  actions.className = 'music-track-group-actions';
  actions.append(renderGroupToggle(group, isExpanded), renderGroupUpload(group));

  const variants = document.createElement('div');
  variants.className = 'music-track-variants';
  variants.id = groupElementId(group);
  variants.setAttribute('aria-label', `Variants of ${group.primary.title}`);
  if (isExpanded) {
    variants.replaceChildren(...group.tracks.slice(1).map(track => renderTrack(track, { group, variant: true })));
  }

  primaryRow.append(renderTrack(group.primary, { group }), actions);
  wrapper.append(primaryRow, variants);
  return wrapper;
}

function isGroupExpanded(group) {
  if (collapsedGroups.has(group.id)) return false;

  const query = search.value.trim();
  const hasActiveVariant = group.tracks.some(track => (
    track.id === currentTrack?.id && track.id !== group.primary.id
  ));
  return expandedGroups.has(group.id) || Boolean(query) || hasActiveVariant;
}

function renderGroupToggle(group, isExpanded) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'music-group-action music-group-toggle';
  button.dataset.action = 'toggle-group';
  button.dataset.groupId = group.id;
  button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  button.setAttribute('aria-controls', groupElementId(group));
  button.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Show'} ${group.tracks.length - 1} more track${group.tracks.length === 2 ? '' : 's'} for ${group.primary.title}`);
  button.title = isExpanded ? 'Collapse tracks' : 'Show tracks';
  button.innerHTML = `
    <span class="music-group-action-count">${group.tracks.length - 1}</span>
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  `;
  return button;
}

function renderGroupUpload(group) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'music-group-action music-group-upload';
  button.dataset.action = 'upload-group';
  button.dataset.groupId = group.id;
  button.setAttribute('aria-label', `Add audio to ${group.primary.title}`);
  button.title = 'Add track to this group';
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </svg>
  `;
  return button;
}

function syncTrackRow(trackId) {
  if (!trackId) return;
  list.querySelectorAll(`.music-archive-track[data-track-id="${CSS.escape(trackId)}"]`).forEach((item) => {
    const track = trackById.get(item.dataset.trackId);
    if (!track) return;

    const isActive = track.id === currentTrack?.id;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    item.querySelector('.music-track-number').textContent = isActive
      ? (audio.paused ? 'Play' : 'Pause')
      : trackNumbers.get(item.dataset.trackId);
    item.querySelector('.music-archive-meta').textContent = isActive
      ? activeTrackMeta(track)
      : trackMeta(track);
  });
}

function syncActiveRows() {
  syncTrackRow(previousActiveTrackId);
  syncTrackRow(currentTrack?.id);
}

function syncCurrentRowProgress() {
  syncTrackRow(currentTrack?.id);
}

function updatePlayerText(track = currentTrack) {
  const totalDuration = formatDurationSummary(totalTrackDuration(tracks));
  playerTitle.textContent = track?.title || 'Select a track';
  playerMeta.textContent = track
    ? trackMeta(track)
    : [`${tracks.length} tracks`, totalDuration].filter(Boolean).join(' / ');
  playerDuration.textContent = formatClock(audio.duration || track?.durationSeconds);
}

function setBuffering(next) {
  isBuffering = Boolean(next);
  playerToggle.classList.toggle('is-buffering', isBuffering && Boolean(currentTrack));
  visualizer?.classList.toggle('is-buffering', isBuffering && Boolean(currentTrack));
}

function updateDownloadProgress(fraction) {
  const clamped = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  playerProgress.style.setProperty('--player-download', `${clamped * 100}%`);
}

function bufferedFraction() {
  const duration = audio.duration || currentTrack?.durationSeconds || 0;
  if (!duration || !audio.buffered || !audio.buffered.length) return 0;

  let end = 0;
  for (let i = 0; i < audio.buffered.length; i += 1) {
    if (audio.buffered.start(i) <= audio.currentTime + 0.25) {
      end = Math.max(end, audio.buffered.end(i));
    }
  }
  if (!end) end = audio.buffered.end(audio.buffered.length - 1);
  return clamp(end / duration, 0, 1);
}

function updateBufferedDisplay() {
  playerProgress.style.setProperty('--player-buffered', `${bufferedFraction() * 100}%`);
}

function updatePlaybackState() {
  const hasTrack = Boolean(currentTrack);
  const isPlaying = hasTrack && !audio.paused;
  const label = hasTrack
    ? `${audio.paused ? 'Play' : 'Pause'} ${currentTrack.title}`
    : 'Select a track to play';

  playerToggle.disabled = !hasTrack;
  playerShuffle.disabled = !trackGroups.length;
  playerProgress.disabled = !hasTrack;
  playerToggle.classList.toggle('is-playing', isPlaying);
  playerToggle.setAttribute('aria-label', label);
  playerToggle.title = label;
  playerToggle.querySelector('.music-player-toggle-label').textContent = audio.paused ? 'Play' : 'Pause';
  syncActiveRows();
}

function updateProgress() {
  const duration = audio.duration || currentTrack?.durationSeconds || 0;
  const progress = duration ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0;
  if (!isSeeking) {
    playerProgress.value = duration ? String(progress * 1000) : '0';
  }
  playerProgress.style.setProperty('--player-progress', `${progress * 100}%`);
  playerCurrent.textContent = formatClock(audio.currentTime);
  playerDuration.textContent = formatClock(duration);
  updateBufferedDisplay();
  syncCurrentRowProgress();
}

async function startAudioPlayback() {
  const playPromise = audio.play();
  startVisualizerPlayback()
    .then(() => updateVisualizerState())
    .catch(() => updateVisualizerState());
  await playPromise;
}

async function playTrack(track) {
  const isNewTrack = currentTrack?.id !== track.id;
  previousActiveTrackId = currentTrack?.id || null;
  currentTrack = track;
  const token = playToken += 1;

  updatePlayerText(track);
  updatePlaybackState();

  if (isNewTrack) {
    updateDownloadProgress(0);
    try {
      await trackLoader.attach(audio, track);
    } catch {
      audio.src = track.url;
    }
    // A newer track was requested while this one was still loading.
    if (token !== playToken) return;
  }

  try {
    await startAudioPlayback();
  } catch {
    updatePlaybackState();
    updateVisualizerState();
  }
}

function nextVisibleTrack() {
  const pool = visibleGroups.length ? visibleGroups : trackGroups;
  if (!pool.length) return null;

  const currentGroupId = currentTrack ? groupByTrackId.get(currentTrack.id)?.id : null;
  const index = pool.findIndex(group => group.id === currentGroupId);
  const next = pool[(index + 1) % pool.length];
  return next?.primary || null;
}

function prefetchUpcoming() {
  const next = nextVisibleTrack();
  if (next && next.id !== currentTrack?.id) trackLoader.prefetch(next);
}

function randomVisibleTrack() {
  const pool = visibleGroups.length ? visibleGroups : trackGroups;
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0].primary;

  const currentGroupId = currentTrack ? groupByTrackId.get(currentTrack.id)?.id : null;
  let nextGroup = pool[Math.floor(Math.random() * pool.length)];
  while (nextGroup.id === currentGroupId) {
    nextGroup = pool[Math.floor(Math.random() * pool.length)];
  }
  return nextGroup.primary;
}

function shuffleTrack() {
  const nextTrack = randomVisibleTrack();
  if (nextTrack) playTrack(nextTrack);
}

function scheduleGroupRender(callback) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 140 });
    return;
  }
  window.setTimeout(callback, 0);
}

function renderGroupList(groups) {
  const revision = ++renderRevision;
  let nextIndex = 0;
  list.setAttribute('aria-busy', 'true');

  const appendNextChunk = () => {
    if (revision !== renderRevision) return;

    const chunkSize = nextIndex ? GROUP_RENDER_CHUNK_SIZE : INITIAL_GROUP_RENDER_COUNT;
    const nextGroups = groups.slice(nextIndex, nextIndex + chunkSize);
    const elements = nextGroups.map(renderGroup);
    if (nextIndex) list.append(...elements);
    else list.replaceChildren(...elements);
    nextIndex += nextGroups.length;

    if (nextIndex < groups.length) {
      scheduleGroupRender(appendNextChunk);
      return;
    }
    list.setAttribute('aria-busy', 'false');
  };

  appendNextChunk();
}

function render() {
  const query = search.value.trim().toLowerCase();
  const searchedGroups = query
    ? trackGroups.filter(group => group.tracks.some(track => (
      trackSearchTextById.get(track.id)?.includes(query)
    )))
    : trackGroups;
  const filteredGroups = showFavoritesOnly
    ? searchedGroups
      .map(group => ({
        ...group,
        tracks: group.tracks.filter(track => isFavoriteTrack(track.id)),
      }))
      .filter(group => group.tracks.length)
      .map(group => ({
        ...group,
        primary: isFavoriteTrack(group.primary.id) ? group.primary : group.tracks[0],
      }))
    : searchedGroups;
  const filteredTrackCount = filteredGroups.reduce((sum, group) => sum + group.tracks.length, 0);
  const filteredDuration = formatDurationSummary(totalTrackDuration(filteredGroups.flatMap(group => group.tracks)));
  const durationLabel = filteredDuration
    ? `${filteredDuration} ${filteredTrackCount === tracks.length ? 'total' : 'visible'}`
    : '';

  visibleGroups = filteredGroups;
  visibleTracks = filteredGroups.map(group => group.primary);

  if (filteredGroups.length) {
    renderGroupList(filteredGroups);
  } else {
    renderRevision += 1;
    const empty = document.createElement('p');
    empty.className = 'music-archive-empty';
    empty.textContent = catalogLoaded ? 'No tracks found.' : 'Loading tracks...';
    list.replaceChildren(empty);
    list.setAttribute('aria-busy', catalogLoaded ? 'false' : 'true');
  }

  favoritesFilter?.classList.toggle('is-active', showFavoritesOnly);
  favoritesFilter?.setAttribute('aria-pressed', showFavoritesOnly ? 'true' : 'false');
  count.textContent = [
    `${filteredTrackCount} / ${tracks.length} tracks`,
    durationLabel,
    `${filteredGroups.length} groups`,
    `${favoriteTrackIds.size} favorites`,
  ].filter(Boolean).join(' · ');
}

async function loadCatalog() {
  try {
    const response = await fetch('/api/music-catalog');
    const isJson = response.headers.get('content-type')?.includes('application/json');
    if (response.ok && isJson) {
      applyCatalog(await response.json());
      return;
    }
  } catch {
    // The checked-in catalog below keeps local/static builds functional.
  }

  try {
    const { default: fallbackCatalog } = await import('./data/yng-music.json');
    applyCatalog(fallbackCatalog);
  } catch {
    catalogLoaded = true;
    render();
  }
}

rebuildTrackNumbers();
search.addEventListener('input', () => {
  if (searchRenderRaf) cancelAnimationFrame(searchRenderRaf);
  searchRenderRaf = requestAnimationFrame(() => {
    searchRenderRaf = 0;
    render();
  });
});
sort.addEventListener('change', () => {
  tracks = sortTracks(tracks);
  rebuildTrackNumbers();
  render();
  syncActiveRows();
});
favoritesFilter?.addEventListener('click', () => {
  showFavoritesOnly = !showFavoritesOnly;
  render();
  syncActiveRows();
});
list.addEventListener('click', (event) => {
  const favoriteButton = event.target.closest('.music-track-favorite');
  if (favoriteButton) {
    const trackId = favoriteButton.dataset.trackId;
    setFavoriteTrack(trackId, !isFavoriteTrack(trackId));
    render();
    syncActiveRows();
    return;
  }

  const actionButton = event.target.closest('.music-group-action');
  if (actionButton) {
    const group = trackGroups.find(nextGroup => nextGroup.id === actionButton.dataset.groupId);
    if (!group) return;

    if (actionButton.dataset.action === 'toggle-group') {
      if (isGroupExpanded(group)) {
        expandedGroups.delete(group.id);
        collapsedGroups.add(group.id);
      } else {
        collapsedGroups.delete(group.id);
        expandedGroups.add(group.id);
      }
      render();
      syncActiveRows();
    }

    if (actionButton.dataset.action === 'upload-group') {
      pendingUploadGroup = group;
      setUploadStatus(`Choose audio for ${groupLabel(group)}.`);
      uploadInput.click();
    }

    return;
  }

  const item = event.target.closest('.music-archive-track');
  if (!item) return;

  const track = trackById.get(item.dataset.trackId);
  if (!track) return;

  if (currentTrack?.id === track.id) {
    if (audio.paused) {
      startAudioPlayback().catch(() => {
        updatePlaybackState();
        updateVisualizerState();
      });
    } else {
      audio.pause();
    }
  } else {
    playTrack(track);
  }
});
const supportsHover = window.matchMedia?.('(hover: hover)')?.matches;
if (supportsHover) {
  list.addEventListener('pointerover', (event) => {
    const item = event.target.closest('.music-archive-track');
    if (!item) return;
    const track = trackById.get(item.dataset.trackId);
    // Warm the cache on hover — a strong signal the listener is about to play it.
    if (track && track.id !== currentTrack?.id) trackLoader.prefetch(track);
  });
}
list.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('button')) return;

  const item = event.target.closest('.music-archive-track');
  if (!item) return;

  event.preventDefault();
  item.click();
});

playerToggle.addEventListener('click', () => {
  if (!currentTrack) return;
  if (audio.paused) {
    startAudioPlayback().catch(() => {
      updatePlaybackState();
      updateVisualizerState();
    });
  } else {
    audio.pause();
  }
});
playerShuffle.addEventListener('click', shuffleTrack);

playerProgress.addEventListener('input', () => {
  if (!currentTrack) return;
  isSeeking = true;
  const duration = audio.duration || currentTrack.durationSeconds || 0;
  audio.currentTime = duration * (Number(playerProgress.value) / 1000);
  updateProgress();
});

playerProgress.addEventListener('change', () => {
  isSeeking = false;
  updateProgress();
});

audio.addEventListener('loadedmetadata', () => {
  updatePlayerText();
  updateProgress();
});
audio.addEventListener('timeupdate', () => {
  updateProgress();
});
audio.addEventListener('play', () => {
  updatePlaybackState();
  updateVisualizerState();
});
audio.addEventListener('playing', () => {
  setBuffering(false);
  prefetchUpcoming();
  startVisualizerPlayback()
    .then(() => updateVisualizerState())
    .catch(() => updateVisualizerState());
});
audio.addEventListener('canplay', () => setBuffering(false));
audio.addEventListener('canplaythrough', () => setBuffering(false));
audio.addEventListener('waiting', () => {
  if (currentTrack && !audio.paused) setBuffering(true);
});
audio.addEventListener('stalled', () => {
  if (currentTrack && !audio.paused) setBuffering(true);
});
audio.addEventListener('progress', updateBufferedDisplay);
audio.addEventListener('error', () => setBuffering(false));
audio.addEventListener('pause', () => {
  setBuffering(false);
  pauseVisualizerPlayback();
  updatePlaybackState();
  updateVisualizerState();
});
audio.addEventListener('ended', () => {
  setBuffering(false);
  pauseVisualizerPlayback();
  updatePlaybackState();
  updateVisualizerState();
});
uploadButton.addEventListener('click', () => {
  pendingUploadGroup = null;
  uploadInput.click();
});
uploadInput.addEventListener('change', () => uploadFiles(uploadInput.files, pendingUploadGroup));
upload.addEventListener('dragenter', (event) => {
  event.preventDefault();
  uploadDragDepth += 1;
  upload.classList.add('is-dragging');
});
upload.addEventListener('dragover', (event) => {
  event.preventDefault();
  upload.classList.add('is-dragging');
});
upload.addEventListener('dragleave', () => {
  uploadDragDepth = Math.max(0, uploadDragDepth - 1);
  if (!uploadDragDepth) upload.classList.remove('is-dragging');
});
upload.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadDragDepth = 0;
  upload.classList.remove('is-dragging');
  uploadFiles(event.dataTransfer.files);
});

updatePlayerText(null);
updatePlaybackState();
updateVisualizerState();
startVisualizerLoop();
render();
loadCatalog();
