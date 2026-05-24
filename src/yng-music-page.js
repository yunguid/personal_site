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

const tracks = [...musicCatalog.tracks].sort((a, b) => a.title.localeCompare(b.title));
const trackNumbers = new Map(tracks.map((track, index) => [track.id, String(index + 1).padStart(3, '0')]));
const audio = new Audio();
audio.preload = 'none';

let currentTrack = null;
let isSeeking = false;

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

function renderTrack(track) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'music-archive-track';
  item.dataset.trackId = track.id;
  item.setAttribute('aria-pressed', currentTrack?.id === track.id ? 'true' : 'false');
  if (currentTrack?.id === track.id) item.classList.add('is-active');

  const number = document.createElement('span');
  number.className = 'music-track-number';
  number.textContent = trackNumbers.get(track.id);

  const title = document.createElement('span');
  title.className = 'music-track-title';
  title.textContent = track.title;

  const meta = document.createElement('p');
  meta.className = 'music-archive-meta';
  meta.textContent = trackMeta(track);

  item.append(number, title, meta);
  return item;
}

function syncActiveRows() {
  list.querySelectorAll('.music-archive-track').forEach((item) => {
    const isActive = item.dataset.trackId === currentTrack?.id;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
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
}

function updateProgress() {
  const duration = audio.duration || currentTrack?.durationSeconds || 0;
  if (!isSeeking) {
    playerProgress.value = duration ? String((audio.currentTime / duration) * 1000) : '0';
  }
  playerCurrent.textContent = formatClock(audio.currentTime);
  playerDuration.textContent = formatClock(duration);
}

async function playTrack(track) {
  const isNewTrack = currentTrack?.id !== track.id;
  currentTrack = track;

  if (isNewTrack) {
    audio.src = track.url;
    audio.currentTime = 0;
    playerProgress.value = '0';
  }

  updatePlayerText(track);
  syncActiveRows();
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

summary.textContent = `${tracks.length} exported tracks.`;
search.addEventListener('input', render);
list.addEventListener('click', (event) => {
  const item = event.target.closest('.music-archive-track');
  if (!item) return;

  const track = tracks.find(candidate => candidate.id === item.dataset.trackId);
  if (track) playTrack(track);
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

updatePlayerText(null);
updatePlaybackState();
render();
