import './styles/main.css';
import musicCatalog from './data/yng-music.json';

const list = document.getElementById('music-list');
const search = document.getElementById('music-search');
const sort = document.getElementById('music-sort');
const count = document.getElementById('music-count');
const summary = document.getElementById('music-summary');
const playerToggle = document.getElementById('music-player-toggle');
const playerShuffle = document.getElementById('music-player-shuffle');
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
let visibleTracks = tracks;
let trackGroups = [];
let visibleGroups = [];
let trackNumbers = new Map();
let trackById = new Map();
let groupByTrackId = new Map();
let pendingUploadGroup = null;
const expandedGroups = new Set();
const collapsedGroups = new Set();
const audio = new Audio();
audio.preload = 'none';
playerProgress.style.setProperty('--player-progress', '0%');

const UPLOAD_CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
};

let currentTrack = null;
let isSeeking = false;
let isUploading = false;
let uploadDragDepth = 0;

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

function formatUploadedDate(track) {
  const timestamp = trackUploadedTimestamp(track);
  return timestamp ? dateFormatter.format(new Date(timestamp)) : '';
}

function trackMeta(track) {
  return [
    track.format.toUpperCase(),
    formatUploadedDate(track),
    track.duration,
    formatBytes(track.sizeBytes),
  ].filter(Boolean).join(' / ');
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

function setUploadStatus(message) {
  uploadStatus.textContent = message;
  upload.classList.toggle('has-status', Boolean(message));
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
  tracks = sortTracks(catalog.tracks);
  rebuildTrackNumbers();
  summary.textContent = `${tracks.length} exported tracks.`;
  render();
  syncActiveRows();
}

async function uploadFile(file, key, index, total, group = null) {
  if (!isUploadableAudio(file)) {
    throw new Error(`${file.name} is not an MP3 or WAV file.`);
  }

  const groupTitle = group ? groupLabel(group) : '';
  const uploadLabel = groupTitle ? `Adding to ${groupTitle}` : 'Uploading';

  setUploadStatus(`${uploadLabel}: hashing ${index} / ${total}`);
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

  setUploadStatus(`${uploadLabel}: signing ${index} / ${total}`);
  const signed = await postUploadAction(base, key);

  setUploadStatus(`${uploadLabel}: uploading ${index} / ${total}`);
  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: file,
  });
  if (!uploadResponse.ok) throw new Error(`S3 upload failed for ${file.name}.`);

  setUploadStatus(`${uploadLabel}: saving ${index} / ${total}`);
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
      : `Uploaded ${files.length} track${files.length === 1 ? '' : 's'}.`);
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
  const item = document.createElement('button');
  item.type = 'button';
  item.className = variant ? 'music-archive-track music-track-variant' : 'music-archive-track';
  item.dataset.trackId = track.id;
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

  item.append(number, title, meta);
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

function render() {
  const query = search.value.trim().toLowerCase();
  const filteredGroups = query
    ? trackGroups.filter(group => group.tracks.some(track => (
      track.title.toLowerCase().includes(query)
      || track.fileName.toLowerCase().includes(query)
      || track.groupTitle?.toLowerCase().includes(query)
    )))
    : trackGroups;
  const filteredTrackCount = filteredGroups.reduce((sum, group) => sum + group.tracks.length, 0);

  visibleGroups = filteredGroups;
  visibleTracks = filteredGroups.map(group => group.primary);

  if (filteredGroups.length) {
    list.replaceChildren(...filteredGroups.map(renderGroup));
  } else {
    const empty = document.createElement('p');
    empty.className = 'music-archive-empty';
    empty.textContent = 'No tracks found.';
    list.replaceChildren(empty);
  }

  count.textContent = `${filteredTrackCount} / ${tracks.length} tracks · ${filteredGroups.length} groups`;
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
sort.addEventListener('change', () => {
  tracks = sortTracks(tracks);
  rebuildTrackNumbers();
  render();
  syncActiveRows();
});
list.addEventListener('click', (event) => {
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
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('play', updatePlaybackState);
audio.addEventListener('pause', updatePlaybackState);
audio.addEventListener('ended', updatePlaybackState);
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
render();
loadCatalog();
