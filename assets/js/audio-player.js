/**
 * Custom Audio Player
 * 
 * Features:
 * - Custom controls with play/pause, seek, and volume
 * - Audio waveform visualization
 * - Dark mode compatibility
 * - Mobile-responsive design
 */

document.addEventListener('DOMContentLoaded', function() {
    // Music Productions Configuration
    const s3BaseUrl = 'https://lukemusicbucket.s3.us-east-2.amazonaws.com';
    const musicFiles = [
        { title: 'Sunrise', artist: '', fileName: 'SUNRISE.mp3', duration: '1:21' },  
        { title: 'Karlsim', artist: '', fileName: 'karlsim.mp3', duration: '1:03' },
        { title: 'Buy One', artist: '', fileName: 'buy one.mp3', duration: '1:20' },
        { title: 'Romestreetz', artist: '', fileName: 'romestreetz.mp3', duration: '1:06' },
        { title: 'UBR Drivers', artist: '', fileName: 'ubr_drivers.mp3', duration: '0:58' },
        { title: '127', artist: '', fileName: 'baby2.mp3', duration: '1:15' }
    ];

    // Initialize the Audio Players
    initializeAudioPlayers();

    /**
     * Sets up all audio players for the production section
     */
    function initializeAudioPlayers() {
        const productionList = document.getElementById('production-list');
        if (!productionList) return;
        
        // Clear any existing content
        productionList.innerHTML = '';
        
        // Create player for each track
        musicFiles.forEach((item, index) => {
            const fileUrl = `${s3BaseUrl}/${item.fileName}`;
            
            // Create player container
            const playerContainer = document.createElement('div');
            playerContainer.className = 'custom-audio-player';
            playerContainer.id = `player-${index}`;
            
            // Generate random bar heights for waveform visualization
            const waveformBars = Array.from({ length: 20 }, () => 
                Math.floor(Math.random() * 70) + 10
            );
            
            const waveformHTML = waveformBars.map(height => 
                `<div class="waveform-bar" style="height: ${height}%"></div>`
            ).join('');
            
            playerContainer.innerHTML = `
                <div class="audio-container">
                    <div class="track-info">
                        <span class="track-title">${item.title}</span>
                        <span class="track-duration">${item.duration}</span>
                    </div>
                    <div class="waveform-container" id="waveform-${index}">
                        ${waveformHTML}
                    </div>
                    <div class="audio-controls">
                        <button class="player-button play-pause-btn" data-player="${index}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                        </button>
                        <div class="progress-container" id="progress-container-${index}">
                            <div class="progress-bar" id="progress-bar-${index}"></div>
                        </div>
                        <div class="volume-container">
                            <button class="player-button volume-btn" data-player="${index}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                                </svg>
                            </button>
                            <input type="range" class="volume-slider" id="volume-${index}" min="0" max="1" step="0.1" value="0.7">
                        </div>
                    </div>
                    <audio id="audio-${index}" preload="metadata">
                        <source src="${fileUrl}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `;
            
            productionList.appendChild(playerContainer);
        });
        
        // Setup player functionality
        setupAudioPlayers();
    }

    /**
     * Adds event listeners and functionality to audio players
     */
    function setupAudioPlayers() {
        musicFiles.forEach((_, index) => {
            const audio = document.getElementById(`audio-${index}`);
            if (!audio) return;

            const playPauseBtn = document.querySelector(`.play-pause-btn[data-player="${index}"]`);
            const progressBar = document.getElementById(`progress-bar-${index}`);
            const progressContainer = document.getElementById(`progress-container-${index}`);
            const volumeSlider = document.getElementById(`volume-${index}`);
            const waveformContainer = document.getElementById(`waveform-${index}`);
            const waveformBars = waveformContainer?.querySelectorAll('.waveform-bar');
            
            if (!playPauseBtn || !progressBar || !progressContainer || !volumeSlider || !waveformContainer) return;
            
            // Set initial volume
            audio.volume = 0.7;
            
            // Play/Pause functionality
            playPauseBtn.addEventListener('click', () => {
                if (audio.paused) {
                    // Pause all other players first
                    document.querySelectorAll('audio').forEach(a => {
                        if (a.id !== `audio-${index}` && !a.paused) {
                            a.pause();
                            const otherIndex = a.id.split('-')[1];
                            resetPlayButton(otherIndex);
                            stopWaveformAnimation(otherIndex);
                        }
                    });
                    
                    audio.play();
                    playPauseBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                        </svg>
                    `;
                    startWaveformAnimation(index);
                } else {
                    audio.pause();
                    resetPlayButton(index);
                    stopWaveformAnimation(index);
                }
            });
            
            // Update progress bar as audio plays
            audio.addEventListener('timeupdate', () => {
                const progress = (audio.currentTime / audio.duration) * 100;
                progressBar.style.width = `${progress}%`;
            });
            
            // Allow seeking
            progressContainer.addEventListener('click', (e) => {
                const clickPos = e.offsetX / progressContainer.offsetWidth;
                audio.currentTime = clickPos * audio.duration;
            });
            
            // Volume control
            volumeSlider.addEventListener('input', () => {
                audio.volume = volumeSlider.value;
            });
            
            // Reset when audio ends
            audio.addEventListener('ended', () => {
                resetPlayButton(index);
                progressBar.style.width = '0%';
                stopWaveformAnimation(index);
            });
        });
    }
    
    /**
     * Starts the waveform animation for a particular track
     * @param {number} index - The track index
     */
    function startWaveformAnimation(index) {
        const bars = document.querySelectorAll(`#waveform-${index} .waveform-bar`);
        bars.forEach((bar, i) => {
            const delay = i * 0.05;
            const height = Math.floor(Math.random() * 70) + 10;
            bar.style.animation = `sound 0.5s ease-in-out infinite alternate ${delay}s`;
            
            // Use solid black in light mode, solid white in dark mode
            const isDarkMode = document.body.classList.contains('dark-mode');
            bar.style.background = isDarkMode ? 
                'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
        });
    }
    
    /**
     * Stops the waveform animation for a particular track
     * @param {number} index - The track index 
     */
    function stopWaveformAnimation(index) {
        const bars = document.querySelectorAll(`#waveform-${index} .waveform-bar`);
        bars.forEach(bar => {
            bar.style.animation = 'none';
            
            // Use transparent black in light mode, transparent white in dark mode
            const isDarkMode = document.body.classList.contains('dark-mode');
            bar.style.background = isDarkMode ? 
                'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
        });
    }
    
    /**
     * Resets the play button to its default state
     * @param {number} index - The track index
     */
    function resetPlayButton(index) {
        const btn = document.querySelector(`.play-pause-btn[data-player="${index}"]`);
        if (!btn) return;
        
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
        `;
    }
    
    // Listen for dark mode changes to update waveform colors
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', updateWaveformColors);
    }
    
    /**
     * Updates the waveform colors when dark mode is toggled
     */
    function updateWaveformColors() {
        const isDarkMode = document.body.classList.contains('dark-mode');
        
        document.querySelectorAll('.waveform-bar').forEach(bar => {
            // Check if this is an active waveform (animation is running)
            const isActive = bar.style.animation && bar.style.animation !== 'none';
            
            if (isActive) {
                bar.style.background = isDarkMode ? 
                    'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
            } else {
                bar.style.background = isDarkMode ? 
                    'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
            }
        });
    }
});

// Define the sound animation for waveform
document.head.insertAdjacentHTML('beforeend', `
    <style>
        @keyframes sound {
            0% {
                height: 10%;
            }
            100% {
                height: 80%;
            }
        }

        .player-button {
            background: transparent;
            border: none;
            cursor: pointer;
            color: #1a202c;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.2s ease;
        }

        .dark-mode .player-button {
            color: #f3f4f6;
        }

        .player-button:hover {
            background: rgba(0,0,0,0.05);
        }

        .dark-mode .player-button:hover {
            background: rgba(255,255,255,0.1);
        }

        .progress-container {
            flex: 1;
            height: 5px;
            background: rgba(0,0,0,0.1);
            border-radius: 5px;
            overflow: hidden;
            cursor: pointer;
            position: relative;
        }

        .dark-mode .progress-container {
            background: rgba(255,255,255,0.1);
        }

        .progress-bar {
            height: 100%;
            width: 0%;
            background: #4f46e5;
            border-radius: 5px;
            transition: width 0.1s linear;
        }

        .dark-mode .progress-bar {
            background: #818cf8;
        }

        .volume-container {
            display: flex;
            align-items: center;
            width: 100px;
        }

        .volume-slider {
            width: 60px;
            height: 4px;
            appearance: none;
            border-radius: 2px;
            background: rgba(0,0,0,0.1);
            outline: none;
            transition: all 0.2s ease;
        }

        .dark-mode .volume-slider {
            background: rgba(255,255,255,0.1);
        }

        .volume-slider::-webkit-slider-thumb {
            appearance: none;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #4f46e5;
            cursor: pointer;
        }

        .dark-mode .volume-slider::-webkit-slider-thumb {
            background: #818cf8;
        }

        .volume-slider::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #4f46e5;
            cursor: pointer;
            border: none;
        }

        .dark-mode .volume-slider::-moz-range-thumb {
            background: #818cf8;
        }

        .audio-controls {
            display: flex;
            align-items: center;
            padding: 0.75rem 1rem;
            gap: 0.75rem;
        }

        .waveform-container {
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .track-title {
            font-weight: 600;
            font-size: 0.95rem;
            margin-right: auto;
            letter-spacing: -0.01em;
        }

        .track-info .track-duration {
            font-size: 0.75rem;
            opacity: 0.75;
            font-variant-numeric: tabular-nums;
        }

        .production-section-header {
            position: relative;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
        }

        .production-section-header::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 3rem;
            height: 2px;
            background: #4f46e5;
        }

        .dark-mode .production-section-header::after {
            background: #818cf8;
        }

        .production-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
        }

        @media (max-width: 768px) {
            .production-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
`); 