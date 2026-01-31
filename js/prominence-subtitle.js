/**
 * Prominence Subtitle - Dynamic Speech Overlay
 * 
 * Integrates Web Speech API with PROMINENCE_Detection (libsyllable Wasm)
 * to dynamically adjust subtitle font sizes based on prosodic stress.
 * 
 * Design based on:
 * - WCAG accessibility guidelines
 * - Dynamik paper (12pt/18pt sizing research)
 * - MaxPooling word-level aggregation
 */

class ProminenceSubtitle {
    constructor() {
        // DOM elements
        this.statusEl = document.getElementById('status');
        this.subtitleTextEl = document.getElementById('subtitle_text');
        this.webcamEl = document.getElementById('webcam');
        this.debugCalibrationEl = document.getElementById('debug_calibration');
        this.debugProminenceEl = document.getElementById('debug_prominence');

        // Prominence detector (Wasm)
        this.prominenceDetector = null;

        // Speech recognition
        this.recognition = null;
        this.isRecognizing = false;

        // Prominence buffer for word alignment (MaxPooling)
        this.prominenceBuffer = [];
        this.bufferWindowMs = 3000; // Keep 3 seconds of prominence events

        // Current display state
        this.currentWords = [];
        this.interimWords = [];

        // Voice calibration state
        this.isVoiceCalibrating = false;
        this.calibrationScores = [];
        this.calibrationCountEl = null;
        this.totalProminenceEvents = 0;

        // Settings
        this.settings = {
            language: 'en-US',
            baseSize: 24,
            sensitivityThreshold: {
                smallMax: 0.35,
                normalMax: 0.65
            },
            // Calibration-derived thresholds (will be updated)
            calibratedMin: 0.2,
            calibratedMax: 0.8
        };

        // Timing
        this.lastWordTime = 0;
        this.wordTimeEstimates = []; // For post-hoc alignment
    }

    /**
     * Initialize the system
     */
    async init() {
        this.setStatus('Initializing...', 'processing');

        try {
            // Initialize webcam
            await this.initWebcam();

            // Initialize prominence detector (Wasm)
            await this.initProminenceDetector();

            // Initialize speech recognition
            this.initSpeechRecognition();

            // Setup UI controls
            this.setupControls();

            this.setStatus('Ready - Speak in English', 'ready');

        } catch (error) {
            console.error('Initialization error:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Initialize webcam
     */
    async initWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: false // Audio handled separately by prominence detector
            });

            this.webcamEl.srcObject = stream;
        } catch (error) {
            console.warn('Webcam not available:', error);
            // Continue without webcam - subtitles still work
        }
    }

    /**
     * Initialize PROMINENCE_Detection Wasm module
     */
    async initProminenceDetector() {
        // Check if SyllableModule is loaded (from syllable.js)
        if (typeof SyllableModule === 'undefined') {
            throw new Error('Wasm module not loaded. Check syllable.js path.');
        }

        this.prominenceDetector = new ProminenceDetectorWasm({
            sampleRate: 48000,
            prominenceThreshold: 0.35,      // Increased from 0.15 - less sensitive
            minSyllableDistMs: 200,         // Increased from 150 - prevent rapid triggering
            minEnergyThreshold: 0.001,      // Increased - filter whisper-level sounds
            calibrationDurationMs: 2000,

            onReady: () => {
                console.log('[Prominence] Wasm detector ready');
            },

            onCalibrationStart: () => {
                this.setStatus('Calibrating... Please stay quiet', 'calibrating');
                if (this.debugCalibrationEl) {
                    this.debugCalibrationEl.textContent = 'Calibrating...';
                }
            },

            onCalibrationEnd: () => {
                this.setStatus('Ready - Speak in English', 'ready');
                if (this.debugCalibrationEl) {
                    this.debugCalibrationEl.textContent = 'Calibrated ✓';
                }
            },

            onProminence: (event) => {
                this.handleProminenceEvent(event);
            },

            onError: (error) => {
                console.error('[Prominence] Error:', error);
            }
        });

        // Start the detector (includes mic access)
        const success = await this.prominenceDetector.start();
        if (!success) {
            throw new Error('Failed to start prominence detector');
        }
    }

    /**
     * Initialize Web Speech API
     */
    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('[Speech] Not supported, enabling demo mode');
            this.enableDemoMode();
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = this.settings.language;
        this.recognition.interimResults = true;
        this.recognition.continuous = true;
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => this.handleSpeechResult(event);

        this.recognition.onerror = (event) => {
            console.warn('[Speech] Error:', event.error);
            if (event.error === 'network') {
                // Network error - enable demo mode as fallback
                this.setStatus('Speech API unavailable - Demo Mode', 'processing');
                this.enableDemoMode();
                return;
            }
            if (event.error === 'no-speech' || event.error === 'aborted') {
                // Restart recognition
                this.restartRecognition();
            }
        };

        this.recognition.onend = () => {
            if (this.isRecognizing && !this.demoMode) {
                // Auto-restart
                this.restartRecognition();
            }
        };

        this.recognition.start();
        this.isRecognizing = true;
    }

    /**
     * Enable demo mode when speech recognition is unavailable
     */
    enableDemoMode() {
        this.demoMode = true;
        this.demoWords = [
            { text: 'The', emphasized: false },
            { text: 'QUICK', emphasized: true },
            { text: 'brown', emphasized: false },
            { text: 'FOX', emphasized: true },
            { text: 'jumps', emphasized: false },
            { text: 'OVER', emphasized: true },
            { text: 'the', emphasized: false },
            { text: 'LAZY', emphasized: true },
            { text: 'dog', emphasized: false }
        ];
        this.demoIndex = 0;
        console.log('[Demo] Mode enabled - speak to trigger word display');
    }

    /**
     * Handle demo mode prominence - adds next word on each prominence event
     */
    handleDemoProminence(event) {
        if (!this.demoMode) return;

        // Get next demo word
        if (this.demoIndex < this.demoWords.length) {
            const demoWord = this.demoWords[this.demoIndex];
            this.currentWords.push({
                text: demoWord.text,
                prominenceScore: demoWord.emphasized ? 0.8 : 0.3,
                isInterim: false
            });
            this.demoIndex++;
            this.renderSubtitles();
        }

        // Reset after showing all words
        if (this.demoIndex >= this.demoWords.length) {
            setTimeout(() => {
                this.currentWords = [];
                this.demoIndex = 0;
                this.renderSubtitles();
            }, 3000);
        }
    }

    /**
     * Restart speech recognition
     */
    restartRecognition() {
        try {
            this.recognition.start();
        } catch (e) {
            // Already started, ignore
        }
    }

    /**
     * Handle prominence event from Wasm detector
     */
    handleProminenceEvent(event) {
        const now = performance.now();
        this.totalProminenceEvents++;

        // Add to buffer
        this.prominenceBuffer.push({
            timestamp: now,
            score: event.fusionScore,
            features: event.features
        });

        // Prune old events
        this.pruneProminenceBuffer(now);

        // Update debug display
        if (this.debugProminenceEl) {
            this.debugProminenceEl.textContent = `Score: ${event.fusionScore.toFixed(2)}`;
        }

        // Update events counter
        const eventsEl = document.getElementById('debug_events');
        if (eventsEl) {
            eventsEl.textContent = `Events: ${this.totalProminenceEvents}`;
        }

        // Collect calibration data if voice calibrating
        if (this.isVoiceCalibrating) {
            this.calibrationScores.push(event.fusionScore);
            if (this.calibrationCountEl) {
                this.calibrationCountEl.textContent = this.calibrationScores.length;
            }
        }

        // Handle demo mode if active
        if (this.demoMode) {
            this.handleDemoProminence(event);
        }
    }

    /**
     * Prune old prominence events from buffer
     */
    pruneProminenceBuffer(now) {
        const cutoff = now - this.bufferWindowMs;
        this.prominenceBuffer = this.prominenceBuffer.filter(e => e.timestamp > cutoff);
    }

    /**
     * Handle speech recognition result
     */
    handleSpeechResult(event) {
        const now = performance.now();
        let finalText = '';
        let interimText = '';

        // Process results
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;

            if (result.isFinal) {
                finalText += transcript;
            } else {
                interimText += transcript;
            }
        }

        // Process final words
        if (finalText) {
            const words = this.tokenizeWords(finalText);
            const alignedWords = this.alignWordsWithProminence(words, now);

            // Add to current words
            this.currentWords.push(...alignedWords);

            // Keep only recent words (last 2 lines worth)
            this.trimCurrentWords();
        }

        // Process interim words
        if (interimText) {
            const words = this.tokenizeWords(interimText);
            // Interim words get default prominence
            this.interimWords = words.map(text => ({
                text,
                prominenceScore: 0.5,
                isInterim: true
            }));
        } else {
            this.interimWords = [];
        }

        // Render subtitles
        this.renderSubtitles();
    }

    /**
     * Tokenize text into words
     */
    tokenizeWords(text) {
        return text.trim().split(/\s+/).filter(w => w.length > 0);
    }

    /**
     * Align words with prominence scores (Weighted Mean with syllable-length proxy)
     * High-performance single-pass calculation
     */
    alignWordsWithProminence(words, recognitionTime) {
        const numWords = words.length;
        if (numWords === 0) return [];

        // Estimate word timing (simple equal distribution over buffer window)
        const windowMs = Math.min(this.bufferWindowMs, 2000);
        const wordDurationMs = windowMs / Math.max(numWords, 1);

        return words.map((text, index) => {
            // Estimate when this word was spoken
            const estimatedTime = recognitionTime - windowMs + (index + 0.5) * wordDurationMs;

            // Find prominence events near this time
            const toleranceMs = wordDurationMs * 1.5;
            const nearbyEvents = this.prominenceBuffer.filter(e =>
                Math.abs(e.timestamp - estimatedTime) < toleranceMs
            );

            // Default score when no events detected
            if (nearbyEvents.length === 0) {
                return {
                    text,
                    prominenceScore: 0.2,
                    isInterim: false
                };
            }

            // Weighted Mean: weight = energy * duration proxy
            // Single-pass calculation for efficiency
            let weightedSum = 0;
            let totalWeight = 0;

            for (let i = 0; i < nearbyEvents.length; i++) {
                const event = nearbyEvents[i];
                const energy = event.features?.energy || 0.1;

                // Duration proxy: time gap to next event (or default 100ms)
                let durationWeight = 100; // default ms
                if (i < nearbyEvents.length - 1) {
                    durationWeight = Math.min(300, nearbyEvents[i + 1].timestamp - event.timestamp);
                }

                // Combined weight: energy * duration
                const weight = energy * durationWeight;
                weightedSum += event.score * weight;
                totalWeight += weight;
            }

            const weightedMean = totalWeight > 0 ? weightedSum / totalWeight : 0.2;

            return {
                text,
                prominenceScore: weightedMean,
                isInterim: false
            };
        });
    }

    /**
     * Trim current words to prevent overflow
     */
    trimCurrentWords() {
        const maxWords = 20; // Keep roughly 2 lines
        if (this.currentWords.length > maxWords) {
            this.currentWords = this.currentWords.slice(-maxWords);
        }
    }

    /**
     * Convert prominence score to size level
     */
    scoreToLevel(score) {
        const t = this.settings.sensitivityThreshold;
        if (score < t.smallMax) return 'small';
        if (score < t.normalMax) return 'normal';
        return 'large';
    }

    /**
     * Render subtitles to DOM
     */
    renderSubtitles() {
        const allWords = [...this.currentWords, ...this.interimWords];

        // Clear existing
        this.subtitleTextEl.innerHTML = '';

        // Create word spans
        allWords.forEach(word => {
            const span = document.createElement('span');
            span.className = 'subtitle-word';
            span.textContent = word.text;

            // Add size class based on prominence
            const sizeLevel = this.scoreToLevel(word.prominenceScore);
            span.classList.add(`size-${sizeLevel}`);

            // Add interim styling if applicable
            if (word.isInterim) {
                span.classList.add('interim');
            }

            this.subtitleTextEl.appendChild(span);
        });
    }

    /**
     * Setup UI controls
     */
    setupControls() {
        // Controls checkbox
        const checkboxControls = document.getElementById('checkbox_controls');
        const controlsPanel = document.getElementById('controls_panel');

        checkboxControls?.addEventListener('change', () => {
            controlsPanel.style.display = checkboxControls.checked ? 'block' : 'none';
        });

        // Language selector
        const selectLanguage = document.getElementById('select_language');
        selectLanguage?.addEventListener('change', () => {
            this.settings.language = selectLanguage.value;
            if (this.recognition) {
                this.recognition.lang = this.settings.language;
                this.recognition.stop();
                this.restartRecognition();
            }
        });

        // Base size slider
        const sliderBaseSize = document.getElementById('slider_base_size');
        const valueBaseSize = document.getElementById('value_base_size');

        sliderBaseSize?.addEventListener('input', () => {
            const value = parseInt(sliderBaseSize.value);
            valueBaseSize.textContent = value;

            // Update CSS variables
            const root = document.documentElement;
            root.style.setProperty('--size-small', `${Math.round(value * 0.67)}px`);
            root.style.setProperty('--size-normal', `${value}px`);
            root.style.setProperty('--size-large', `${Math.round(value * 1.33)}px`);
        });

        // Sensitivity slider
        const sliderSensitivity = document.getElementById('slider_sensitivity');
        const valueSensitivity = document.getElementById('value_sensitivity');

        sliderSensitivity?.addEventListener('input', () => {
            const value = parseInt(sliderSensitivity.value);
            valueSensitivity.textContent = value;

            // Adjust thresholds based on sensitivity
            // Higher sensitivity = lower thresholds = more words marked as "large"
            const factor = 1 - (value / 100) * 0.5; // 0.5 to 1.0
            this.settings.sensitivityThreshold = {
                smallMax: 0.35 * factor,
                normalMax: 0.65 * factor
            };
        });

        // Recalibrate button
        const btnRecalibrate = document.getElementById('btn_recalibrate');
        btnRecalibrate?.addEventListener('click', () => {
            if (this.prominenceDetector) {
                this.prominenceDetector.startCalibration();
            }
        });

        // Voice calibration button
        const btnVoiceCalibrate = document.getElementById('btn_voice_calibrate');
        const calibrationPrompt = document.getElementById('calibration_prompt');
        const btnFinishCalibration = document.getElementById('btn_finish_calibration');
        this.calibrationCountEl = document.getElementById('calibration_count');

        btnVoiceCalibrate?.addEventListener('click', () => {
            this.startVoiceCalibration();
            calibrationPrompt?.classList.remove('hidden');
        });

        btnFinishCalibration?.addEventListener('click', () => {
            this.finishVoiceCalibration();
            calibrationPrompt?.classList.add('hidden');
        });

        // Debug checkbox
        const checkboxDebug = document.getElementById('checkbox_debug');
        const debugInfo = document.getElementById('debug_info');

        checkboxDebug?.addEventListener('change', () => {
            debugInfo?.classList.toggle('hidden', !checkboxDebug.checked);
        });

        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreen_btn');
        const videoWrapper = document.getElementById('video_wrapper');

        fullscreenBtn?.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                videoWrapper?.requestFullscreen();
            }
        });
    }

    /**
     * Set status display
     */
    setStatus(message, className) {
        this.statusEl.textContent = message;
        this.statusEl.className = `status ${className}`;
    }

    /**
     * Start voice calibration mode
     */
    startVoiceCalibration() {
        this.isVoiceCalibrating = true;
        this.calibrationScores = [];
        this.setStatus('Voice Calibrating - Read the phrase!', 'calibrating');
        console.log('[Calibration] Started voice calibration');
    }

    /**
     * Finish voice calibration and update thresholds
     */
    finishVoiceCalibration() {
        this.isVoiceCalibrating = false;

        if (this.calibrationScores.length < 5) {
            this.setStatus('Not enough data - try again (need 5+ events)', 'error');
            console.warn('[Calibration] Not enough data:', this.calibrationScores.length);
            return;
        }

        // Calculate statistics
        const sorted = [...this.calibrationScores].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const median = sorted[Math.floor(sorted.length / 2)];
        const range = max - min;

        console.log('[Calibration] Stats:', {
            min: min.toFixed(3),
            max: max.toFixed(3),
            median: median.toFixed(3),
            range: range.toFixed(3),
            count: sorted.length
        });

        // Update thresholds based on calibration
        // Small: below 25th percentile
        // Normal: 25th to 75th percentile
        // Large: above 75th percentile
        const p25 = sorted[Math.floor(sorted.length * 0.25)];
        const p75 = sorted[Math.floor(sorted.length * 0.75)];

        this.settings.sensitivityThreshold = {
            smallMax: p25,
            normalMax: p75
        };
        this.settings.calibratedMin = min;
        this.settings.calibratedMax = max;

        this.setStatus(`Calibrated! Range: ${min.toFixed(2)} - ${max.toFixed(2)}`, 'ready');
        console.log('[Calibration] New thresholds:', this.settings.sensitivityThreshold);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.recognition) {
            this.isRecognizing = false;
            this.recognition.stop();
        }

        if (this.prominenceDetector) {
            this.prominenceDetector.destroy();
        }

        if (this.webcamEl.srcObject) {
            this.webcamEl.srcObject.getTracks().forEach(t => t.stop());
        }
    }
}

// Also need ProminenceDetectorWasm class (from PROMINENCE_Detection)
// Import it inline since we're loading from a different path

class ProminenceDetectorWasm {
    constructor(options = {}) {
        this.config = {
            sampleRate: options.sampleRate || 48000,
            prominenceThreshold: options.prominenceThreshold || 0.2,
            minSyllableDistMs: options.minSyllableDistMs || 200,
            calibrationDurationMs: options.calibrationDurationMs || 2000,
            minEnergyThreshold: options.minEnergyThreshold || 0.0001,
        };

        this.wasmModule = null;
        this.detector = null;
        this.isReady = false;
        this.isRunning = false;
        this.isCalibrating = false;

        this.audioContext = null;
        this.scriptProcessor = null;
        this.mediaStream = null;

        this.lastProminenceTime = 0;
        this.inputBuffer = null;
        this._frameCount = 0;

        this.onProminence = options.onProminence || (() => { });
        this.onFrame = options.onFrame || (() => { });
        this.onCalibrationStart = options.onCalibrationStart || (() => { });
        this.onCalibrationEnd = options.onCalibrationEnd || (() => { });
        this.onError = options.onError || ((err) => console.error(err));
        this.onReady = options.onReady || (() => { });
    }

    async init() {
        try {
            this.wasmModule = await SyllableModule();

            this._syllable_create = this.wasmModule.cwrap('syllable_create', 'number', ['number']);
            this._syllable_process = this.wasmModule.cwrap('syllable_process', 'number',
                ['number', 'number', 'number', 'number', 'number']);
            this._syllable_destroy = this.wasmModule.cwrap('syllable_destroy', null, ['number']);
            this._syllable_set_realtime_mode = this.wasmModule.cwrap('syllable_set_realtime_mode', null, ['number', 'number']);
            this._syllable_recalibrate = this.wasmModule.cwrap('syllable_recalibrate', null, ['number']);
            this._syllable_is_calibrating = this.wasmModule.cwrap('syllable_is_calibrating', 'number', ['number']);
            this._syllable_set_snr_threshold = this.wasmModule.cwrap('syllable_set_snr_threshold', null, ['number', 'number']);

            this.detector = this._syllable_create(0);
            this._syllable_set_snr_threshold(this.detector, 6.0);
            this._syllable_set_realtime_mode(this.detector, 1);

            if (!this.detector) {
                throw new Error('Failed to create Wasm detector');
            }

            this.isReady = true;
            this.onReady();
            return true;
        } catch (err) {
            this.onError(err);
            return false;
        }
    }

    async start() {
        if (!this.isReady) {
            const success = await this.init();
            if (!success) return false;
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: this.config.sampleRate
                }
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.config.sampleRate
            });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            const bufferSize = 1024;
            this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
            this.inputBuffer = this.wasmModule._malloc(bufferSize * 4);

            this.scriptProcessor.onaudioprocess = (e) => this._processAudioBuffer(e);

            source.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            this.isRunning = true;
            this.startCalibration();

            return true;
        } catch (err) {
            this.onError(err);
            return false;
        }
    }

    stop() {
        this.isRunning = false;
        this.isCalibrating = false;

        if (this._calibrationCheckInterval) {
            clearInterval(this._calibrationCheckInterval);
        }
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.inputBuffer) {
            this.wasmModule._free(this.inputBuffer);
            this.inputBuffer = null;
        }
    }

    startCalibration() {
        this.isCalibrating = true;
        this.onCalibrationStart();

        if (this._syllable_recalibrate) {
            this._syllable_recalibrate(this.detector);
        }

        this._calibrationCheckInterval = setInterval(() => {
            const stillCalibrating = this._syllable_is_calibrating(this.detector);
            if (!stillCalibrating) {
                this._finishCalibration();
                clearInterval(this._calibrationCheckInterval);
            }
        }, 100);
    }

    _finishCalibration() {
        this.isCalibrating = false;
        this.onCalibrationEnd({});
    }

    _processAudioBuffer(e) {
        if (!this.isRunning || !this.detector || !this.wasmModule) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const numSamples = inputData.length;

        for (let i = 0; i < numSamples; i++) {
            this.wasmModule.setValue(this.inputBuffer + i * 4, inputData[i], 'float');
        }

        const maxEvents = 8;
        const eventSize = 72;
        const eventBuffer = this.wasmModule._malloc(maxEvents * eventSize);

        const numEvents = this._syllable_process(
            this.detector,
            this.inputBuffer,
            numSamples,
            eventBuffer,
            maxEvents
        );

        if (numEvents > 0) {
            for (let i = 0; i < numEvents; i++) {
                const basePtr = eventBuffer + i * eventSize;

                const fusionScore = this.wasmModule.getValue(basePtr + 56, 'float');
                const energy = this.wasmModule.getValue(basePtr + 24, 'float');
                const spectralFlux = this.wasmModule.getValue(basePtr + 40, 'float');

                if (this.isCalibrating) continue;

                const now = performance.now();
                const timeSinceLastProminence = now - this.lastProminenceTime;

                const hasEnoughEnergy = energy > this.config.minEnergyThreshold || spectralFlux > 0.1;
                const passedThreshold = fusionScore > this.config.prominenceThreshold;
                const passedTiming = timeSinceLastProminence > this.config.minSyllableDistMs;

                if (passedThreshold && passedTiming && hasEnoughEnergy) {
                    this.lastProminenceTime = now;
                    this.onProminence({
                        timestamp: now,
                        fusionScore: fusionScore,
                        features: {
                            energy: energy,
                            spectralFlux: spectralFlux,
                            highFreqEnergy: this.wasmModule.getValue(basePtr + 44, 'float'),
                            mfccDelta: this.wasmModule.getValue(basePtr + 48, 'float')
                        }
                    });
                }
            }
        }

        this.wasmModule._free(eventBuffer);
    }

    destroy() {
        this.stop();
        if (this.detector) {
            this._syllable_destroy(this.detector);
            this.detector = null;
        }
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.prominenceSubtitle = new ProminenceSubtitle();
    window.prominenceSubtitle.init();
});
