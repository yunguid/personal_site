/**
 * Audio Player Component
 * Handles audio playback with waveform visualization
 */

const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;

const PAUSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

const VOLUME_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;

// Track all active audio elements for exclusive playback
const activeAudios = new Set();

export class AudioPlayer {
  constructor(container, track, index) {
    this.container = container;
    this.track = track;
    this.index = index;
    this.audio = null;
    this.isPlaying = false;

    this.render();
    this.bindEvents();
  }

  generateWaveform() {
    return Array.from({ length: 50 }, () => Math.floor(Math.random() * 60) + 5)
      .map(height => `<div class="waveform-bar" style="height: ${height}%"></div>`)
      .join('');
  }

  render() {
    this.container.className = 'custom-audio-player';
    this.container.id = `player-${this.index}`;

    this.container.innerHTML = `
      <div class="audio-container">
        <div class="track-info">
          <span class="track-title">${this.track.title}</span>
          <span class="track-duration">${this.track.duration}</span>
        </div>
        <div class="waveform-container" id="waveform-${this.index}">
          ${this.generateWaveform()}
        </div>
        <div class="audio-controls">
          <button class="player-button play-pause-btn" data-player="${this.index}" aria-label="Play">
            ${PLAY_ICON}
          </button>
          <div class="progress-container" id="progress-container-${this.index}">
            <div class="progress-bar" id="progress-bar-${this.index}"></div>
          </div>
          <div class="volume-container">
            <button class="player-button volume-btn" data-player="${this.index}" aria-label="Volume">
              ${VOLUME_ICON}
            </button>
            <input type="range" class="volume-slider" id="volume-${this.index}" min="0" max="1" step="0.1" value="0.7">
          </div>
        </div>
        <audio id="audio-${this.index}" preload="metadata">
          <source src="${this.track.url}">
        </audio>
      </div>
    `;

    this.audio = this.container.querySelector('audio');
    this.playPauseBtn = this.container.querySelector('.play-pause-btn');
    this.progressBar = this.container.querySelector('.progress-bar');
    this.progressContainer = this.container.querySelector('.progress-container');
    this.volumeSlider = this.container.querySelector('.volume-slider');
    this.waveformContainer = this.container.querySelector('.waveform-container');

    activeAudios.add(this);
  }

  bindEvents() {
    if (!this.audio) return;

    this.audio.volume = 0.7;

    // Play/Pause
    this.playPauseBtn.addEventListener('click', () => this.togglePlay());

    // Progress update
    this.audio.addEventListener('timeupdate', () => {
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      const progress = duration > 0 ? (this.audio.currentTime / duration) * 100 : 0;
      this.progressBar.style.width = `${progress}%`;
    });

    // Seeking
    this.progressContainer.addEventListener('click', (e) => {
      const clickPos = e.offsetX / this.progressContainer.offsetWidth;
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
      if (duration > 0) {
        this.audio.currentTime = clickPos * duration;
      }
    });

    // Volume
    this.volumeSlider.addEventListener('input', () => {
      const vol = parseFloat(this.volumeSlider.value);
      this.audio.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.7;
    });

    // Reset on end
    this.audio.addEventListener('ended', () => {
      this.pause();
      this.progressBar.style.width = '0%';
    });

    // Media Session API
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: this.track.title,
          artist: 'Luke Young',
        });
        navigator.mediaSession.setActionHandler('play', () => this.audio.play());
        navigator.mediaSession.setActionHandler('pause', () => this.audio.pause());
      } catch (_) {}
    }
  }

  togglePlay() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  play() {
    // Pause all other players
    activeAudios.forEach(player => {
      if (player !== this && !player.audio.paused) {
        player.pause();
      }
    });

    const playPromise = this.audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => this.showPlaying())
        .catch(() => this.showPaused());
      return;
    }

    this.showPlaying();
  }

  pause() {
    this.audio.pause();
    this.showPaused();
  }

  showPlaying() {
    this.isPlaying = true;
    this.playPauseBtn.innerHTML = PAUSE_ICON;
    this.startWaveformAnimation();
  }

  showPaused() {
    this.isPlaying = false;
    this.playPauseBtn.innerHTML = PLAY_ICON;
    this.stopWaveformAnimation();
  }

  startWaveformAnimation() {
    const bars = this.waveformContainer.querySelectorAll('.waveform-bar');
    bars.forEach((bar, i) => {
      const delay = i * 0.05;
      bar.style.animation = `sound 0.5s ease-in-out infinite alternate ${delay}s`;
      bar.style.opacity = '0.7';
    });
  }

  stopWaveformAnimation() {
    const bars = this.waveformContainer.querySelectorAll('.waveform-bar');
    bars.forEach(bar => {
      bar.style.animation = 'none';
      bar.style.opacity = '0.2';
    });
  }

  destroy() {
    activeAudios.delete(this);
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
  }
}
