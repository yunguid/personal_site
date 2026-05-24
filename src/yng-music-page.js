import './styles/main.css';
import musicCatalog from './data/yng-music.json';

const list = document.getElementById('music-list');
const search = document.getElementById('music-search');
const count = document.getElementById('music-count');
const summary = document.getElementById('music-summary');
const playerToggle = document.getElementById('music-player-toggle');
const playerTitle = document.getElementById('music-player-title');
const playerMeta = document.getElementById('music-player-meta');
const playerCurrent = document.getElementById('music-player-current');
const playerDuration = document.getElementById('music-player-duration');
const playerProgress = document.getElementById('music-player-progress');
const upload = document.getElementById('music-upload');
const uploadInput = document.getElementById('music-upload-input');
const uploadButton = document.getElementById('music-upload-button');
const uploadStatus = document.getElementById('music-upload-status');

let tracks = sortTracks(musicCatalog.tracks);
let trackNumbers = new Map();
let trackById = new Map();
const audio = new Audio();
audio.preload = 'none';

let currentTrack = null;
let isSeeking = false;
let isUploading = false;
let uploadDragDepth = 0;

function sortTracks(nextTracks) {
  return [...nextTracks].sort((a, b) => a.title.localeCompare(b.title));
}

function rebuildTrackNumbers() {
  trackNumbers = new Map(tracks.map((track, index) => [track.id, String(index + 1).padStart(3, '0')]));
  trackById = new Map(tracks.map(track => [track.id, track]));
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

function trackMeta(track) {
  return [
    track.format.toUpperCase(),
    track.duration,
    formatBytes(track.sizeBytes),
  ].filter(Boolean).join(' / ');
}

function activeTrackMeta(track) {
  const duration = audio.duration || track.durationSeconds || 0;
  return [
    track.format.toUpperCase(),
    `${formatClock(audio.currentTime)} / ${formatClock(duration)}`,
    formatBytes(track.sizeBytes),
  ].filter(Boolean).join(' / ');
}

function setUploadStatus(message) {
  uploadStatus.textContent = message;
  upload.classList.toggle('has-status', Boolean(message));
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
  tracks = sortTracks(catalog.tracks);
  rebuildTrackNumbers();
  summary.textContent = `${tracks.length} exported tracks.`;
  render();
  syncActiveRows();
}

async function uploadFile(file, key, index, total) {
  if (!file.name.toLowerCase().endsWith('.mp3')) {
    throw new Error(`${file.name} is not an .mp3 file.`);
  }

  setUploadStatus(`Hashing ${index} / ${total}`);
  const [sha256, durationSeconds] = await Promise.all([
    sha256File(file),
    durationFromFile(file),
  ]);

  const base = {
    action: 'sign',
    fileName: file.name,
    contentType: 'audio/mpeg',
    sizeBytes: file.size,
    sha256,
    durationSeconds,
  };

  setUploadStatus(`Signing ${index} / ${total}`);
  const signed = await postUploadAction(base, key);

  setUploadStatus(`Uploading ${index} / ${total}`);
  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: file,
  });
  if (!uploadResponse.ok) throw new Error(`S3 upload failed for ${file.name}.`);

  setUploadStatus(`Saving ${index} / ${total}`);
  const completed = await postUploadAction({ ...base, action: 'complete' }, key);
  applyCatalog(completed.catalog);
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter(file => file.name.toLowerCase().endsWith('.mp3'));
  if (isUploading) return;
  if (!files.length) {
    setUploadStatus('No MP3s selected.');
    return;
  }

  const key = uploadKey();
  if (!key) return;

  isUploading = true;
  upload.classList.add('is-uploading');

  try {
    for (const [index, file] of files.entries()) {
      await uploadFile(file, key, index + 1, files.length);
    }
    setUploadStatus(`Uploaded ${files.length} track${files.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setUploadStatus(error.message || 'Upload failed.');
  } finally {
    isUploading = false;
    upload.classList.remove('is-uploading', 'is-dragging');
    uploadInput.value = '';
  }
}

function renderTrack(track) {
  const isActive = currentTrack?.id === track.id;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'music-archive-track';
  item.dataset.trackId = track.id;
  item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  if (isActive) item.classList.add('is-active');

  const number = document.createElement('span');
  number.className = 'music-track-number';
  number.textContent = isActive ? (audio.paused ? 'Play' : 'Pause') : trackNumbers.get(track.id);

  const title = document.createElement('span');
  title.className = 'music-track-title';
  title.textContent = track.title;

  const meta = document.createElement('p');
  meta.className = 'music-archive-meta';
  meta.textContent = isActive ? activeTrackMeta(track) : trackMeta(track);

  item.append(number, title, meta);
  return item;
}

function syncActiveRows() {
  list.querySelectorAll('.music-archive-track').forEach((item) => {
    const track = trackById.get(item.dataset.trackId);
    const isActive = track?.id === currentTrack?.id;
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

function updatePlayerText(track = currentTrack) {
  playerTitle.textContent = track?.title || 'Select a track';
  playerMeta.textContent = track ? trackMeta(track) : `${tracks.length} tracks`;
  playerDuration.textContent = formatClock(audio.duration || track?.durationSeconds);
}

function updatePlaybackState() {
  const hasTrack = Boolean(currentTrack);
  playerToggle.disabled = !hasTrack;
  playerProgress.disabled = !hasTrack;
  playerToggle.textContent = audio.paused ? 'Play' : 'Pause';
  syncActiveRows();
}

function updateProgress() {
  const duration = audio.duration || currentTrack?.durationSeconds || 0;
  if (!isSeeking) {
    playerProgress.value = duration ? String((audio.currentTime / duration) * 1000) : '0';
  }
  playerCurrent.textContent = formatClock(audio.currentTime);
  playerDuration.textContent = formatClock(duration);
  syncActiveRows();
}

async function playTrack(track) {
  const isNewTrack = currentTrack?.id !== track.id;
  currentTrack = track;

  if (isNewTrack) {
    audio.src = track.url;
    audio.currentTime = 0;
  }

  updatePlayerText(track);
  updatePlaybackState();

  try {
    await audio.play();
  } catch {
    updatePlaybackState();
  }
}

function render() {
  const query = search.value.trim().toLowerCase();
  const filtered = query
    ? tracks.filter(track => track.title.toLowerCase().includes(query) || track.fileName.toLowerCase().includes(query))
    : tracks;

  if (filtered.length) {
    list.replaceChildren(...filtered.map(renderTrack));
  } else {
    const empty = document.createElement('p');
    empty.className = 'music-archive-empty';
    empty.textContent = 'No tracks found.';
    list.replaceChildren(empty);
  }

  count.textContent = `${filtered.length} / ${tracks.length} tracks`;
}

async function loadCatalog() {
  try {
    const response = await fetch('/api/music-catalog', { cache: 'no-store' });
    if (!response.ok) return;
    applyCatalog(await response.json());
  } catch {
    render();
  }
}

rebuildTrackNumbers();
summary.textContent = `${tracks.length} exported tracks.`;
search.addEventListener('input', render);
list.addEventListener('click', (event) => {
  const item = event.target.closest('.music-archive-track');
  if (!item) return;

  const track = trackById.get(item.dataset.trackId);
  if (!track) return;

  if (currentTrack?.id === track.id) {
    if (audio.paused) {
      audio.play().catch(() => updatePlaybackState());
    } else {
      audio.pause();
    }
  } else {
    playTrack(track);
  }
});

playerToggle.addEventListener('click', () => {
  if (!currentTrack) return;
  if (audio.paused) {
    audio.play().catch(() => updatePlaybackState());
  } else {
    audio.pause();
  }
});

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
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('play', updatePlaybackState);
audio.addEventListener('pause', updatePlaybackState);
audio.addEventListener('ended', updatePlaybackState);
uploadButton.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', () => uploadFiles(uploadInput.files));
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
render();
loadCatalog();
