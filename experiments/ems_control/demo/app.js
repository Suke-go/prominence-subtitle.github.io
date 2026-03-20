/**
 * EMS × Prominence — Main Application
 *
 * Pipeline:
 *   Mic → AudioWorklet → syllable.wasm (ProminenceDetectorWasm)
 *     → prominence events → ACN scoring (acn.wasm / JS)
 *       → threshold check → EMS pulse trigger (ems-processor.js)
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// ProminenceDetectorWasm (adapted from prominence-subtitle.js)
// ═══════════════════════════════════════════════════════════════════

class ProminenceDetectorWasm {
  constructor(options = {}) {
    this.config = {
      sampleRate: options.sampleRate || 48000,
      prominenceThreshold: options.prominenceThreshold || 0.20,
      minSyllableDistMs: options.minSyllableDistMs || 150,
      calibrationDurationMs: options.calibrationDurationMs || 2000,
      minEnergyThreshold: options.minEnergyThreshold || 0.001,
    };

    this.wasmModule = null;
    this.detector = null;
    this.isReady = false;
    this.isRunning = false;
    this.isCalibrating = false;

    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.sinkNode = null;
    this.scriptProcessor = null;
    this.mediaStream = null;
    this.useAudioWorklet = false;

    this.lastProminenceTime = 0;
    this.lastProminenceSample = -1;
    this.totalProcessedSamples = 0;
    this.minSyllableDistSamples = Math.max(
      1, Math.round((this.config.minSyllableDistMs * this.config.sampleRate) / 1000.0)
    );
    this.inputBuffer = null;
    this.inputBufferCapacity = 0;

    // ── VAD State ──
    this.vadEnabled = true;
    this.vadRatio = options.vadRatio || 3.0;       // RMS / noiseFloor threshold
    this.vadNoiseFloor = 0.0;
    this.vadNoiseAlpha = 0.0;                       // Will be set based on sampleRate
    this.vadIsSpeech = false;
    this.vadHangoverMs = 200;                       // Hold speech state after offset
    this.vadHangoverSamples = 0;
    this.vadHangoverRemaining = 0;
    this.vadNoiseInitialized = false;
    this.vadCurrentRMS = 0.0;
    this.onVadChange = options.onVadChange || (() => {});

    this.onProminence = options.onProminence || (() => {});
    this.onCalibrationStart = options.onCalibrationStart || (() => {});
    this.onCalibrationEnd = options.onCalibrationEnd || (() => {});
    this.onError = options.onError || ((err) => console.error(err));
    this.onReady = options.onReady || (() => {});
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

      if (!this.detector) throw new Error('Failed to create WASM detector');
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
      const ok = await this.init();
      if (!ok) return false;
    }

    try {
      this.lastProminenceSample = -1;
      this.totalProcessedSamples = 0;

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
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      this.config.sampleRate = this.audioContext.sampleRate;
      this.minSyllableDistSamples = Math.max(
        1, Math.round((this.config.minSyllableDistMs * this.config.sampleRate) / 1000.0)
      );

      // VAD: EMA time constant ~1s for noise floor update
      const vadTauS = 1.0;
      const chunkRate = this.config.sampleRate / 1024; // chunks per second
      this.vadNoiseAlpha = 1.0 / (vadTauS * chunkRate);
      this.vadHangoverSamples = Math.round((this.vadHangoverMs / 1000) * this.config.sampleRate);

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.sinkNode = this.audioContext.createGain();
      this.sinkNode.gain.value = 0;

      const workletReady = await this._setupAudioWorklet();
      if (!workletReady) this._setupScriptProcessorFallback();

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
    if (this._calibrationCheckInterval) clearInterval(this._calibrationCheckInterval);
    if (this.scriptProcessor) { this.scriptProcessor.disconnect(); this.scriptProcessor = null; }
    if (this.workletNode) { this.workletNode.port.onmessage = null; this.workletNode.disconnect(); this.workletNode = null; }
    if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
    if (this.sinkNode) { this.sinkNode.disconnect(); this.sinkNode = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    if (this.inputBuffer) { this.wasmModule._free(this.inputBuffer); this.inputBuffer = null; this.inputBufferCapacity = 0; }
  }

  startCalibration() {
    this.isCalibrating = true;
    this.onCalibrationStart();
    if (this._syllable_recalibrate) this._syllable_recalibrate(this.detector);
    this._calibrationCheckInterval = setInterval(() => {
      if (!this._syllable_is_calibrating(this.detector)) {
        this.isCalibrating = false;
        this.onCalibrationEnd();
        clearInterval(this._calibrationCheckInterval);
      }
    }, 100);
  }

  getSampleRate() { return this.config.sampleRate; }
  getProcessedSamples() { return this.totalProcessedSamples; }

  _readU64(ptr) {
    if (!this.wasmModule || !this.wasmModule.HEAPU32) return NaN;
    const lo = this.wasmModule.HEAPU32[ptr >> 2] >>> 0;
    const hi = this.wasmModule.HEAPU32[(ptr + 4) >> 2] >>> 0;
    return (hi * 4294967296) + lo;
  }

  async _setupAudioWorklet() {
    if (!this.audioContext || !this.audioContext.audioWorklet) return false;
    try {
      await this.audioContext.audioWorklet.addModule('../lib/worklets/audio-chunk-processor.js');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-chunk-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        processorOptions: { chunkSize: 1024 }
      });
      this.workletNode.port.onmessage = (event) => {
        if (event?.data?.audio) this._processAudioSamples(event.data.audio);
      };
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.sinkNode);
      this.sinkNode.connect(this.audioContext.destination);
      this.useAudioWorklet = true;
      return true;
    } catch (e) {
      console.warn('[Prominence] AudioWorklet unavailable:', e);
      return false;
    }
  }

  _setupScriptProcessorFallback() {
    this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => this._processAudioSamples(e.inputBuffer.getChannelData(0));
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.sinkNode);
    this.sinkNode.connect(this.audioContext.destination);
  }

  _ensureInputBuffer(numSamples) {
    if (this.inputBuffer && this.inputBufferCapacity >= numSamples) return;
    if (this.inputBuffer) { this.wasmModule._free(this.inputBuffer); this.inputBuffer = null; }
    this.inputBuffer = this.wasmModule._malloc(numSamples * 4);
    this.inputBufferCapacity = numSamples;
  }

  // ── VAD helpers ──

  _computeRMS(data) {
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      sumSq += data[i] * data[i];
    }
    return Math.sqrt(sumSq / data.length);
  }

  _updateNoiseFloor(rms) {
    if (!this.vadNoiseInitialized) {
      // Seed the noise floor with first chunk
      this.vadNoiseFloor = rms;
      this.vadNoiseInitialized = true;
      return;
    }
    // Only update noise floor when NOT in speech (noise floor should track silence)
    if (!this.vadIsSpeech) {
      this.vadNoiseFloor += this.vadNoiseAlpha * (rms - this.vadNoiseFloor);
    }
    // Clamp minimum noise floor to avoid div-by-zero sensitivity
    if (this.vadNoiseFloor < 1e-6) this.vadNoiseFloor = 1e-6;
  }

  _vadDecision(rms, numSamples) {
    const speechDetected = rms > this.vadNoiseFloor * this.vadRatio;
    const prevState = this.vadIsSpeech;

    if (speechDetected) {
      this.vadIsSpeech = true;
      this.vadHangoverRemaining = this.vadHangoverSamples;
    } else {
      // Hangover: hold speech state for a while after offset
      this.vadHangoverRemaining -= numSamples;
      if (this.vadHangoverRemaining <= 0) {
        this.vadIsSpeech = false;
        this.vadHangoverRemaining = 0;
      }
    }

    // Notify on state change
    if (this.vadIsSpeech !== prevState) {
      this.onVadChange(this.vadIsSpeech, rms);
    }

    return this.vadIsSpeech;
  }

  _processAudioSamples(inputData) {
    if (!this.isRunning || !this.detector || !this.wasmModule) return;
    if (!inputData || inputData.length === 0) return;

    const numSamples = inputData.length;
    const blockStartSample = this.totalProcessedSamples;

    // ── VAD: RMS energy check ──
    const rms = this._computeRMS(inputData);
    this.vadCurrentRMS = rms;
    this._updateNoiseFloor(rms);

    if (this.vadEnabled) {
      const isSpeech = this._vadDecision(rms, numSamples);
      if (!isSpeech) {
        this.totalProcessedSamples += numSamples;
        return; // Skip WASM processing during silence
      }
    }

    this._ensureInputBuffer(numSamples);

    for (let i = 0; i < numSamples; i++) {
      this.wasmModule.setValue(this.inputBuffer + i * 4, inputData[i], 'float');
    }

    const maxEvents = 8;
    const eventSize = 72;
    const eventBuffer = this.wasmModule._malloc(maxEvents * eventSize);
    const numEvents = this._syllable_process(this.detector, this.inputBuffer, numSamples, eventBuffer, maxEvents);

    if (numEvents > 0) {
      for (let i = 0; i < numEvents; i++) {
        const basePtr = eventBuffer + i * eventSize;
        const fusionScore = this.wasmModule.getValue(basePtr + 56, 'float');
        const energy = this.wasmModule.getValue(basePtr + 24, 'float');
        const spectralFlux = this.wasmModule.getValue(basePtr + 40, 'float');

        if (this.isCalibrating) continue;

        const now = performance.now();
        const rawSampleIndex = this._readU64(basePtr);
        const sampleIndex = Number.isFinite(rawSampleIndex) ? rawSampleIndex : (blockStartSample + Math.floor(numSamples * 0.5));
        const sampleDistance = this.lastProminenceSample < 0 ? Infinity : (sampleIndex - this.lastProminenceSample);
        const hasEnoughEnergy = energy > this.config.minEnergyThreshold || spectralFlux > 0.1;
        const passedThreshold = fusionScore > this.config.prominenceThreshold;
        const passedTiming = sampleDistance > this.minSyllableDistSamples;

        if (passedThreshold && passedTiming && hasEnoughEnergy) {
          this.lastProminenceTime = now;
          this.lastProminenceSample = sampleIndex;
          this.onProminence({
            timestamp: now,
            sampleIndex,
            sampleRate: this.config.sampleRate,
            fusionScore,
            features: {
              energy,
              durationS: this.wasmModule.getValue(basePtr + 36, 'float'),
              spectralFlux,
              highFreqEnergy: this.wasmModule.getValue(basePtr + 44, 'float'),
              mfccDelta: this.wasmModule.getValue(basePtr + 48, 'float'),
              f0: this.wasmModule.getValue(basePtr + 28, 'float')
            }
          });
        }
      }
    }

    this.wasmModule._free(eventBuffer);
    this.totalProcessedSamples += numSamples;
  }

  destroy() {
    this.stop();
    if (this.detector) { this._syllable_destroy(this.detector); this.detector = null; }
  }
}


// ═══════════════════════════════════════════════════════════════════
// EMSProminenceApp — Main Application
// ═══════════════════════════════════════════════════════════════════

class EMSProminenceApp {
  constructor() {
    // ── State ──
    this.isRunning = false;
    this.prominenceDetector = null;
    this.acnFeatureExtractor = null;
    this.acnRuntime = null;
    this.enableAcn = false;

    // ── EMS Audio ──
    this.emsAudioCtx = null;
    this.emsWorkletNode = null;

    // ── Prominence event buffer (sliding window for ACN triplet scoring) ──
    this.eventBuffer = [];   // { timestamp, sampleIndex, features, fusionScore }
    this.maxEventBufferSize = 100;

    // ── ACN triplet cue cache ──
    this.cueBuffer = [];     // { cues: [logDur, logEnergy, logSpectral], timestamp }
    this.maxCueBufferSize = 50;

    // ── Parameters ──
    this.threshold = 0.60;
    this.maxAmplitude = 0;
    this.carrierFreq = 4000;
    this.pulseDurationMs = 100;
    this.cooldownMs = 200;
    this.waveform = 0;
    this.lastPulseTime = 0;
    this.totalEvents = 0;
    this.totalPulses = 0;

    // ── Latency mode ──
    this.latencyMode = 'low';  // 'low' = causal (no ACN triplet), 'normal' = ACN triplet

    // ── Waveform visualization ──
    this.waveformData = new Float32Array(128);
    this.animFrameId = null;

    // ── DOM elements ──
    this.els = {};
  }

  // ── Initialize ──

  async init() {
    this._cacheDom();
    this._bindControls();
    this._setStatus('Initializing...', '');
    console.log('[EMS×Prominence] Initializing...');

    try {
      // 1. Initialize prominence detector (syllable.wasm)
      await this._initProminenceDetector();

      // 2. Initialize ACN runtime
      await this._initAcnRuntime();

      // 3. Initialize EMS audio engine
      await this._initEmsAudio();

      this._setStatus('Ready — Press Start', 'ready');
      console.log('[EMS×Prominence] Ready');
    } catch (err) {
      console.error('[EMS×Prominence] Init error:', err);
      this._setStatus(`Error: ${err.message}`, 'error');
    }
  }

  async _initProminenceDetector() {
    if (typeof SyllableModule === 'undefined') {
      throw new Error('syllable.wasm not loaded. Check script path.');
    }

    this.prominenceDetector = new ProminenceDetectorWasm({
      sampleRate: 48000,
      prominenceThreshold: 0.20,
      minSyllableDistMs: 150,
      minEnergyThreshold: 0.001,
      calibrationDurationMs: 2000,
      vadRatio: 3.0,

      onReady: () => console.log('[Prominence] WASM detector ready'),

      onCalibrationStart: () => {
        this._setStatus('Calibrating... Stay quiet', 'calibrating');
      },

      onCalibrationEnd: () => {
        if (this.isRunning) {
          this._setStatus('Listening for prominence...', 'ready');
        }
      },

      onProminence: (event) => this._handleProminenceEvent(event),

      onVadChange: (isSpeech, rms) => this._handleVadChange(isSpeech, rms),

      onError: (err) => console.error('[Prominence] Error:', err),
    });
  }

  async _initAcnRuntime() {
    if (typeof ACNFeatureExtractor === 'undefined' || typeof ACNRuntime === 'undefined') {
      console.warn('[ACN] Runtime scripts not loaded. Using fusionScore only.');
      this.enableAcn = false;
      this.els.acnBackend.textContent = 'none';
      return;
    }

    this.acnFeatureExtractor = new ACNFeatureExtractor({
      minDurationSec: 0.02,
      nearbyToleranceMs: 250
    });

    const hasWeights = typeof window !== 'undefined' && window.ACN_MODEL_WEIGHTS;
    if (!hasWeights) {
      console.warn('[ACN] Model weights unavailable. Using fusionScore only.');
      this.enableAcn = false;
      this.els.acnBackend.textContent = 'no weights';
      return;
    }

    // Try WASM backend first
    if (typeof ACNWasmRuntime !== 'undefined') {
      try {
        const wasmRuntime = new ACNWasmRuntime({
          normalizationMode: 'session',
          moduleScriptUrl: '../lib/acn.js',
          wasmBinaryUrl: '../lib/acn.wasm'
        });
        const loaded = await wasmRuntime.loadModel(window.ACN_MODEL_WEIGHTS);
        if (loaded) {
          this.acnRuntime = wasmRuntime;
          this.enableAcn = true;
          this.els.acnBackend.textContent = 'wasm';
          console.log(`[ACN] Ready (${wasmRuntime.getModelVersion()}, backend=wasm)`);
          return;
        }
      } catch (e) {
        console.warn('[ACN] WASM unavailable, trying JS fallback:', e);
      }
    }

    // JS fallback
    this.acnRuntime = new ACNRuntime({ normalizationMode: 'session' });
    const loaded = this.acnRuntime.loadModel(window.ACN_MODEL_WEIGHTS);
    this.enableAcn = !!loaded;
    this.els.acnBackend.textContent = loaded ? 'js' : 'failed';
    if (loaded) {
      console.log(`[ACN] Ready (${this.acnRuntime.getModelVersion()}, backend=js)`);
    }
  }

  async _initEmsAudio() {
    this.emsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: 'interactive',
    });

    await this.emsAudioCtx.audioWorklet.addModule('../ems-processor.js');

    this.emsWorkletNode = new AudioWorkletNode(this.emsAudioCtx, 'ems-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.emsWorkletNode.connect(this.emsAudioCtx.destination);

    // Receive waveform data for visualization
    this.emsWorkletNode.port.onmessage = (event) => {
      if (event.data.type === 'waveform') {
        this.waveformData = event.data.data;
      }
    };

    // Send initial params
    this._sendEmsParams();

    this.els.sampleRateInfo.textContent = `${(this.emsAudioCtx.sampleRate / 1000).toFixed(1)} kHz`;
    console.log('[EMS] Audio engine ready');
  }

  _sendEmsParams() {
    if (!this.emsWorkletNode) return;
    this.emsWorkletNode.port.postMessage({
      type: 'params',
      carrierFreq: this.carrierFreq,
      waveform: this.waveform,
      maxAmplitude: this.maxAmplitude / 100,
    });
  }

  _triggerPulse(intensity) {
    if (!this.emsWorkletNode || !this.isRunning) return;
    if (this.maxAmplitude <= 0) return; // Safety: no output if amplitude is 0

    const now = performance.now();
    if (now - this.lastPulseTime < this.cooldownMs) return; // Cooldown

    this.lastPulseTime = now;
    this.totalPulses++;

    this.emsWorkletNode.port.postMessage({
      type: 'pulse',
      durationMs: this.pulseDurationMs,
      intensity: Math.min(1.0, intensity),
      attackMs: 5,
      decayMs: Math.min(30, this.pulseDurationMs * 0.3),
    });

    // Update UI
    this.els.totalPulses.textContent = this.totalPulses;
    this.els.pulseCount.textContent = `${this.totalPulses} pulses`;
    this._flashPulseIndicator();
  }

  // ── Prominence Event Handling ──

  _handleProminenceEvent(event) {
    this.totalEvents++;
    this.els.eventCount.textContent = this.totalEvents;

    // Buffer the event
    this.eventBuffer.push({
      timestamp: event.timestamp,
      sampleIndex: event.sampleIndex,
      fusionScore: event.fusionScore,
      features: event.features,
    });
    if (this.eventBuffer.length > this.maxEventBufferSize) {
      this.eventBuffer.shift();
    }

    // Determine final prominence score based on latency mode
    let finalScore;
    if (this.latencyMode === 'low') {
      // Causal mode: use fusionScore directly, no ACN triplet delay
      finalScore = event.fusionScore;
    } else {
      // Normal mode: ACN triplet scoring (1 syllable delay)
      let acnScore = NaN;
      if (this.enableAcn && this.acnFeatureExtractor && this.acnRuntime) {
        acnScore = this._computeAcnScore(event);
      }
      finalScore = Number.isFinite(acnScore) ? acnScore : event.fusionScore;
    }

    // Update prominence meter
    this._updateProminenceMeter(finalScore);

    // Check threshold and trigger EMS
    const triggered = finalScore >= this.threshold;
    this._addLogEntry(event.timestamp, finalScore, triggered);

    if (triggered) {
      // Map score to intensity: higher prominence → stronger pulse
      const intensity = Math.min(1.0, (finalScore - this.threshold) / (1.0 - this.threshold) * 0.8 + 0.2);
      this._triggerPulse(intensity);
    }
  }

  _handleVadChange(isSpeech, rms) {
    if (this.els.vadDot) {
      this.els.vadDot.className = `vad-indicator__dot ${isSpeech ? 'active' : ''}`;
      this.els.vadText.textContent = isSpeech ? 'Speech' : 'Silence';
      this.els.vadText.style.color = isSpeech ? 'var(--accent-green)' : 'var(--text-muted)';
    }
    if (this.els.statusVad) {
      this.els.statusVad.textContent = isSpeech ? '🟢' : '🔴';
    }
  }

  _computeAcnScore(event) {
    // Create pseudo-cues from event features
    const features = event.features || {};
    const duration = Number.isFinite(features.durationS) ? features.durationS : 0.1;
    const energy = Number.isFinite(features.energy) ? features.energy : 0.001;
    const spectralFlux = Number.isFinite(features.spectralFlux) ? features.spectralFlux : 0.001;
    const highFreq = Number.isFinite(features.highFreqEnergy) ? features.highFreqEnergy : 0;
    const mfccDelta = Number.isFinite(features.mfccDelta) ? Math.abs(features.mfccDelta) : 0;

    const eps = 1e-6;
    const cues = [
      Math.log(Math.max(duration, eps)),
      Math.log(Math.max(energy, eps)),
      Math.log(Math.max(spectralFlux + 0.5 * highFreq + mfccDelta, eps))
    ];

    // Buffer cues for triplet context
    this.cueBuffer.push({ cues, timestamp: event.timestamp });
    if (this.cueBuffer.length > this.maxCueBufferSize) this.cueBuffer.shift();

    // Need at least 3 events for triplet (prev, curr, next is satisfied by using lookahead=current)
    const n = this.cueBuffer.length;
    if (n < 2) return NaN;

    // Score the second-to-last element (one-word delay) with current as next context
    const prevIdx = Math.max(0, n - 3);
    const currIdx = n - 2;
    const nextIdx = n - 1;

    const prevCues = this.cueBuffer[prevIdx].cues;
    const currCues = this.cueBuffer[currIdx].cues;
    const nextCues = this.cueBuffer[nextIdx].cues;

    try {
      const score = this.acnRuntime.scoreTriplet({
        prevCues,
        currCues,
        nextCues,
        hasPrev: currIdx > 0,
        hasNext: true,
      });
      return score;
    } catch (e) {
      return NaN;
    }
  }

  // ── UI Updates ──

  _updateProminenceMeter(score) {
    const pct = Math.max(0, Math.min(100, score * 100));
    this.els.prominenceBar.style.width = `${pct}%`;
    this.els.prominenceScoreText.textContent = score.toFixed(2);
  }

  _flashPulseIndicator() {
    this.els.pulseDot.classList.add('firing');
    this.els.pulseText.textContent = 'PULSE!';
    this.els.pulseText.style.color = 'var(--accent-red)';

    setTimeout(() => {
      this.els.pulseDot.classList.remove('firing');
      this.els.pulseText.textContent = 'Ready';
      this.els.pulseText.style.color = '';
    }, 200);
  }

  _addLogEntry(timestamp, score, triggered) {
    const log = this.els.eventLog;
    // Remove placeholder
    const placeholder = log.querySelector('.event-log__placeholder');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = 'event-log__entry';

    const timeStr = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    entry.innerHTML = `
      <span class="event-log__time">${timeStr}</span>
      <span class="event-log__score">${score.toFixed(3)}</span>
      <span class="${triggered ? 'event-log__pulse' : 'event-log__skip'}">${triggered ? '⚡ PULSE' : '— skip'}</span>
    `;

    log.appendChild(entry);

    // Keep max 50 entries
    while (log.children.length > 50) log.removeChild(log.firstChild);

    // Auto-scroll
    log.scrollTop = log.scrollHeight;
  }

  _setStatus(text, className) {
    const chip = this.els.statusChip;
    chip.className = `status-chip ${className || ''}`;
    chip.querySelector('.status-chip__text').textContent = text;
  }

  // ── Power Toggle ──

  async togglePower() {
    if (!this.isRunning) {
      // Start
      this._setStatus('Starting...', 'calibrating');

      const ok = await this.prominenceDetector.start();
      if (!ok) {
        this._setStatus('Failed to start microphone', 'error');
        return;
      }

      if (this.emsAudioCtx.state === 'suspended') {
        await this.emsAudioCtx.resume();
      }

      // Enable EMS output
      this.emsWorkletNode.port.postMessage({ type: 'enable', value: true });

      this.isRunning = true;
      this.els.powerBtn.classList.add('active');
      this.els.powerLabel.textContent = 'ON';
      this.els.powerLabel.classList.add('active');
      this.els.statusDot.classList.add('active');
      this.els.statusText.textContent = 'Listening';
      this.els.statusMic.textContent = 'Active';

      this._startVisualization();
      this._setStatus('Calibrating... Stay quiet', 'calibrating');
    } else {
      // Stop
      this.prominenceDetector.stop();
      this.emsWorkletNode.port.postMessage({ type: 'stop' });

      this.isRunning = false;
      this.els.powerBtn.classList.remove('active');
      this.els.powerLabel.textContent = 'OFF';
      this.els.powerLabel.classList.remove('active');
      this.els.statusDot.classList.remove('active');
      this.els.statusText.textContent = 'Idle';
      this.els.statusMic.textContent = '--';

      this._stopVisualization();
      this._setStatus('Stopped', '');
    }
  }

  // ── Waveform Visualization ──

  _startVisualization() {
    const canvas = this.els.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = '#0e0e18';
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Center line
      ctx.strokeStyle = 'rgba(77,159,255,0.1)';
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

      // Waveform
      const data = this.waveformData;
      if (data && data.length > 0) {
        const centerY = h / 2;
        const scaleY = h * 0.4;

        ctx.shadowColor = 'rgba(248,113,113,0.5)';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let x = 0; x < w; x++) {
          const idx = Math.min(Math.floor(x * data.length / w), data.length - 1);
          const y = centerY - data[idx] * scaleY;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#f87171';
        ctx.lineTo(w, centerY);
        ctx.lineTo(0, centerY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      this.animFrameId = requestAnimationFrame(draw);
    };
    draw();
  }

  _stopVisualization() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  // ── DOM Caching ──

  _cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.els = {
      powerBtn: $('powerBtn'),
      powerLabel: $('powerLabel'),
      statusChip: $('statusChip'),
      prominenceBar: $('prominenceBar'),
      prominenceThresholdLine: $('prominenceThresholdLine'),
      prominenceScoreText: $('prominenceScoreText'),
      pulseDot: $('pulseDot'),
      pulseText: $('pulseText'),
      pulseCount: $('pulseCount'),
      acnBackend: $('acnBackend'),
      eventCount: $('eventCount'),
      totalPulses: $('totalPulses'),
      waveformCanvas: $('waveformCanvas'),
      sampleRateInfo: $('sampleRateInfo'),
      thresholdSlider: $('thresholdSlider'),
      thresholdValue: $('thresholdValue'),
      amplitudeSlider: $('amplitudeSlider'),
      amplitudeValue: $('amplitudeValue'),
      carrierFreqSlider: $('carrierFreqSlider'),
      carrierFreqValue: $('carrierFreqValue'),
      pulseDurationSlider: $('pulseDurationSlider'),
      pulseDurationValue: $('pulseDurationValue'),
      waveformSelect: $('waveformSelect'),
      cooldownSlider: $('cooldownSlider'),
      cooldownValue: $('cooldownValue'),
      clearLogBtn: $('clearLogBtn'),
      eventLog: $('eventLog'),
      statusDot: $('statusDot'),
      statusText: $('statusText'),
      statusMic: $('statusMic'),
      statusCarrier: $('statusCarrier'),
      statusAmplitude: $('statusAmplitude'),
      // VAD + Latency mode
      vadDot: $('vadDot'),
      vadText: $('vadText'),
      vadSensitivitySlider: $('vadSensitivitySlider'),
      vadSensitivityValue: $('vadSensitivityValue'),
      latencyModeSelect: $('latencyModeSelect'),
      latencyModeInfo: $('latencyModeInfo'),
      statusVad: $('statusVad'),
      // Playback mode (dual port)
      dropZone: $('dropZone'),
      playbackFileInput: $('playbackFileInput'),
      playbackPlayer: $('playbackPlayer'),
      playbackFileName: $('playbackFileName'),
      playbackClearBtn: $('playbackClearBtn'),
      audioPortSelect: $('audioPortSelect'),
      emsPortSelect: $('emsPortSelect'),
      refreshDevicesBtn: $('refreshDevicesBtn'),
      playBtn: $('playBtn'),
      pauseBtn: $('pauseBtn'),
      stopBtn: $('stopBtn'),
      seekSlider: $('seekSlider'),
      transportTime: $('transportTime'),
      statusPlayback: $('statusPlayback'),
      // Mode tabs
      modeRealtimeBtn: $('modeRealtimeBtn'),
      modePlaybackBtn: $('modePlaybackBtn'),
      modeRealtimeSection: $('modeRealtimeSection'),
      modePlaybackSection: $('modePlaybackSection'),
      mediaLibrary: $('mediaLibrary'),
    };
  }

  // ── Control Bindings ──

  _bindControls() {
    // Mode tabs
    this._currentMode = 'realtime';
    if (this.els.modeRealtimeBtn) {
      this.els.modeRealtimeBtn.addEventListener('click', () => this._switchMode('realtime'));
    }
    if (this.els.modePlaybackBtn) {
      this.els.modePlaybackBtn.addEventListener('click', () => this._switchMode('playback'));
    }

    // Power
    this.els.powerBtn.addEventListener('click', () => this.togglePower());

    // Threshold
    this.els.thresholdSlider.addEventListener('input', (e) => {
      this.threshold = parseInt(e.target.value) / 100;
      this.els.thresholdValue.textContent = this.threshold.toFixed(2);
      this.els.prominenceThresholdLine.style.left = `${this.threshold * 100}%`;
    });
    // Set initial threshold line position
    this.els.prominenceThresholdLine.style.left = `${this.threshold * 100}%`;

    // Amplitude
    this.els.amplitudeSlider.addEventListener('input', (e) => {
      this.maxAmplitude = parseInt(e.target.value);
      this.els.amplitudeValue.textContent = `${this.maxAmplitude}%`;
      this.els.statusAmplitude.textContent = `${this.maxAmplitude}%`;
      this._sendEmsParams();
    });

    // Carrier frequency
    this.els.carrierFreqSlider.addEventListener('input', (e) => {
      this.carrierFreq = parseInt(e.target.value);
      this.els.carrierFreqValue.textContent = `${this.carrierFreq} Hz`;
      this.els.statusCarrier.textContent = `${this.carrierFreq} Hz`;
      this._sendEmsParams();
    });

    // Pulse duration
    this.els.pulseDurationSlider.addEventListener('input', (e) => {
      this.pulseDurationMs = parseInt(e.target.value);
      this.els.pulseDurationValue.textContent = `${this.pulseDurationMs} ms`;
    });

    // Waveform
    this.els.waveformSelect.addEventListener('change', (e) => {
      this.waveform = parseInt(e.target.value);
      this._sendEmsParams();
    });

    // Cooldown
    this.els.cooldownSlider.addEventListener('input', (e) => {
      this.cooldownMs = parseInt(e.target.value);
      this.els.cooldownValue.textContent = `${this.cooldownMs} ms`;
    });

    // Clear log
    this.els.clearLogBtn.addEventListener('click', () => {
      this.els.eventLog.innerHTML = '<div class="event-log__placeholder">Waiting for prominence events...</div>';
    });

    // VAD sensitivity
    if (this.els.vadSensitivitySlider) {
      this.els.vadSensitivitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.els.vadSensitivityValue.textContent = val.toFixed(1);
        if (this.prominenceDetector) {
          this.prominenceDetector.vadRatio = val;
        }
      });
    }

    // Latency mode
    if (this.els.latencyModeSelect) {
      this.els.latencyModeSelect.addEventListener('change', (e) => {
        this.latencyMode = e.target.value;
        const info = this.latencyMode === 'low' ? '~21ms (Causal)' : '~270ms (ACN Triplet)';
        this.els.latencyModeInfo.textContent = info;
        console.log(`[EMS] Latency mode: ${this.latencyMode} — ${info}`);
      });
    }

    // ── Playback mode ──
    this._bindPlaybackControls();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        this.togglePower();
      }
      if (e.code === 'Escape') {
        // Emergency stop
        if (this.isRunning) {
          this.maxAmplitude = 0;
          this.els.amplitudeSlider.value = 0;
          this.els.amplitudeValue.textContent = '0%';
          this.els.statusAmplitude.textContent = '0%';
          this._sendEmsParams();
          this.togglePower();
        }
      }
    });

    // Window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (this.isRunning) {
          this._stopVisualization();
          this._startVisualization();
        }
      }, 200);
    });
  }

  // ── Mode Switching ──

  _switchMode(mode) {
    this._currentMode = mode;

    // Update tab buttons
    this.els.modeRealtimeBtn?.classList.toggle('mode-tab--active', mode === 'realtime');
    this.els.modePlaybackBtn?.classList.toggle('mode-tab--active', mode === 'playback');

    // Toggle sections
    this.els.modeRealtimeSection?.classList.toggle('mode-section--hidden', mode !== 'realtime');
    this.els.modePlaybackSection?.classList.toggle('mode-section--hidden', mode !== 'playback');

    // Side effects
    if (mode === 'playback') {
      if (this.isRunning) this.togglePower();
    } else {
      if (this._audioL && !this._audioL.paused) this._playbackPause();
    }

    console.log(`[EMS] Mode: ${mode}`);
  }

  // ── Playback Mode (Dual Port) ──

  _bindPlaybackControls() {
    const dz = this.els.dropZone;
    const fi = this.els.playbackFileInput;
    if (!dz || !fi) return;

    // Playback state
    this._audioL = new Audio();  // L channel → Audio Port
    this._audioR = new Audio();  // R channel → EMS Port
    this._playbackDuration = 0;
    this._seekAnimFrame = null;
    this._playbackReady = false;  // Guard flag

    // Enumerate devices + load library on init
    this._refreshDevices();
    this._loadMediaLibrary();

    // Refresh button
    if (this.els.refreshDevicesBtn) {
      this.els.refreshDevicesBtn.addEventListener('click', () => this._refreshDevices());
    }

    // Click to open file dialog
    dz.addEventListener('click', () => fi.click());

    // Drag-and-drop
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._loadPlaybackFile(e.dataTransfer.files[0]);
    });

    // File input
    fi.addEventListener('change', (e) => {
      if (e.target.files[0]) this._loadPlaybackFile(e.target.files[0]);
    });

    // Transport buttons
    if (this.els.playBtn) this.els.playBtn.addEventListener('click', () => this._playbackPlay());
    if (this.els.pauseBtn) this.els.pauseBtn.addEventListener('click', () => this._playbackPause());
    if (this.els.stopBtn) this.els.stopBtn.addEventListener('click', () => this._playbackStop());

    // Seek slider
    if (this.els.seekSlider) {
      this.els.seekSlider.addEventListener('input', (e) => {
        const t = (parseFloat(e.target.value) / 100) * this._playbackDuration;
        this._audioL.currentTime = t;
        this._audioR.currentTime = t;
      });
    }

    // Clear
    if (this.els.playbackClearBtn) {
      this.els.playbackClearBtn.addEventListener('click', () => this._clearPlayback());
    }

    // Port change → re-route
    if (this.els.audioPortSelect) {
      this.els.audioPortSelect.addEventListener('change', () => this._applyPorts());
    }
    if (this.els.emsPortSelect) {
      this.els.emsPortSelect.addEventListener('change', () => this._applyPorts());
    }
  }

  async _refreshDevices() {
    try {
      // Request permission to see device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');

      const fillSelect = (sel, current) => {
        const prev = sel.value;
        sel.innerHTML = '';
        outputs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Device ${d.deviceId.slice(0, 8)}`;
          sel.appendChild(opt);
        });
        // Restore previous selection if still available
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
      };

      if (this.els.audioPortSelect) fillSelect(this.els.audioPortSelect);
      if (this.els.emsPortSelect) fillSelect(this.els.emsPortSelect);

      console.log(`[Playback] Found ${outputs.length} output devices`);
    } catch (err) {
      console.warn('[Playback] Could not enumerate devices:', err);
    }
  }

  async _applyPorts() {
    const audioId = this.els.audioPortSelect?.value || 'default';
    const emsId = this.els.emsPortSelect?.value || 'default';

    try {
      if (this._audioL.setSinkId) await this._audioL.setSinkId(audioId);
      if (this._audioR.setSinkId) await this._audioR.setSinkId(emsId);
      console.log(`[Playback] Audio → ${audioId.slice(0, 12)}, EMS → ${emsId.slice(0, 12)}`);
    } catch (err) {
      console.warn('[Playback] setSinkId failed:', err);
    }
  }

  // ── Media Library ──

  async _loadMediaLibrary() {
    const lib = this.els.mediaLibrary;
    if (!lib) return;

    try {
      const res = await fetch('../media/manifest.json');
      if (!res.ok) { lib.innerHTML = '<div class="media-library__loading">No media found</div>'; return; }
      const manifest = await res.json();
      const files = manifest.files || [];
      if (!files.length) { lib.innerHTML = '<div class="media-library__loading">No files</div>'; return; }

      lib.innerHTML = '';
      files.forEach(f => {
        const track = document.createElement('div');
        track.className = 'media-track';
        track.dataset.filename = f.name;
        const dur = this._fmtTime(f.duration_s || 0);
        track.innerHTML = `
          <span class="media-track__icon">🎵</span>
          <div class="media-track__info">
            <div class="media-track__label">${f.label || f.name}</div>
            <div class="media-track__meta">${dur} ・ ${f.size_mb} MB</div>
          </div>
          <button class="media-track__play">▶</button>
        `;
        track.addEventListener('click', () => this._loadServerFile(f.name, f.label || f.name));
        lib.appendChild(track);
      });

      console.log(`[Playback] Library: ${files.length} tracks`);
    } catch (err) {
      console.warn('[Playback] Manifest load failed:', err);
      lib.innerHTML = '<div class="media-library__loading">manifest.json not found</div>';
    }
  }

  async _loadServerFile(filename, label) {
    // Stop any current playback
    this._playbackStop();

    this.els.playbackFileName.textContent = label || filename;
    this.els.dropZone.style.display = 'none';
    this.els.playbackPlayer.style.display = 'block';
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '⏳ Loading...';

    // Highlight active track
    this.els.mediaLibrary?.querySelectorAll('.media-track').forEach(t => {
      t.classList.toggle('media-track--active', t.dataset.filename === filename);
    });

    try {
      const res = await fetch(`../media/${filename}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();

      const offCtx = new OfflineAudioContext(2, 1, 48000);
      const audioBuffer = await offCtx.decodeAudioData(arrayBuf);

      if (audioBuffer.numberOfChannels < 2) {
        alert('ステレオNAVを選択してください (L=Audio, R=EMS)');
        this._clearPlayback();
        return;
      }

      const sr = audioBuffer.sampleRate;
      this._playbackDuration = audioBuffer.duration;

      const blobL = this._createMonoWavBlob(audioBuffer.getChannelData(0), sr);
      const blobR = this._createMonoWavBlob(audioBuffer.getChannelData(1), sr);

      // Create fresh Audio elements to avoid stale state
      this._audioL = new Audio();
      this._audioR = new Audio();

      // Apply port routing before setting src
      await this._applyPorts();

      // Wait for both elements to be ready
      const waitReady = (audio, url) => new Promise((resolve) => {
        audio.addEventListener('canplay', resolve, { once: true });
        audio.src = url;
        audio.load();
      });

      await Promise.all([
        waitReady(this._audioL, URL.createObjectURL(blobL)),
        waitReady(this._audioR, URL.createObjectURL(blobR)),
      ]);

      // Reset position
      this._audioL.currentTime = 0;
      this._audioR.currentTime = 0;
      if (this.els.seekSlider) this.els.seekSlider.value = 0;

      if (this.els.transportTime) {
        this.els.transportTime.textContent = `0:00 / ${this._fmtTime(this._playbackDuration)}`;
      }
      console.log(`[Playback] Server file: ${filename} (${this._playbackDuration.toFixed(1)}s)`);

      this._playbackReady = true;

      // Auto-play
      this._playbackPlay();

    } catch (err) {
      console.error('[Playback] Load error:', err);
      this._playbackReady = false;
      if (this.els.statusPlayback) this.els.statusPlayback.textContent = '❌ Load failed';
      if (this.els.playbackFileName) this.els.playbackFileName.textContent = 'Error: サーバーに接続できません';
    }
  }

  async _loadPlaybackFile(file) {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('WAVファイルを選択してください');
      return;
    }

    this.els.playbackFileName.textContent = file.name;
    this.els.dropZone.style.display = 'none';
    this.els.playbackPlayer.style.display = 'block';
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '⏳ Decoding...';

    try {
      const arrayBuf = await file.arrayBuffer();

      // Decode stereo WAV
      const offCtx = new OfflineAudioContext(2, 1, 48000);
      const audioBuffer = await offCtx.decodeAudioData(arrayBuf);

      if (audioBuffer.numberOfChannels < 2) {
        alert('ステレオWAVを選択してください (L=Audio, R=EMS)');
        this._clearPlayback();
        return;
      }

      const sr = audioBuffer.sampleRate;
      const n = audioBuffer.length;
      this._playbackDuration = audioBuffer.duration;

      // Extract L/R channels
      const chL = audioBuffer.getChannelData(0);
      const chR = audioBuffer.getChannelData(1);

      // Create mono WAV blobs
      const blobL = this._createMonoWavBlob(chL, sr);
      const blobR = this._createMonoWavBlob(chR, sr);

      this._audioL.src = URL.createObjectURL(blobL);
      this._audioR.src = URL.createObjectURL(blobR);

      // Apply port routing
      await this._applyPorts();

      if (this.els.statusPlayback) this.els.statusPlayback.textContent = '⏹ Ready';
      if (this.els.transportTime) {
        this.els.transportTime.textContent = `0:00 / ${this._fmtTime(this._playbackDuration)}`;
      }
      console.log(`[Playback] Decoded: ${file.name} (${n} samples, ${(n/sr).toFixed(1)}s, ${sr}Hz stereo)`);
    } catch (err) {
      console.error('[Playback] Decode error:', err);
      alert('WAVファイルのデコードに失敗しました');
      this._clearPlayback();
    }
  }

  _createMonoWavBlob(channelData, sr) {
    const n = channelData.length;
    const buffer = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buffer);

    // RIFF header
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM
    view.setUint16(22, 1, true);      // mono
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true); // byte rate
    view.setUint16(32, 2, true);      // block align
    view.setUint16(34, 16, true);     // bits
    writeStr(36, 'data');
    view.setUint32(40, n * 2, true);

    // PCM data
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(44 + i * 2, s * 32767, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  _playbackPlay() {
    if (!this._playbackReady || !this._audioL.src) return;
    // Reset if at end
    if (this._audioL.duration && this._audioL.currentTime >= this._audioL.duration - 0.1) {
      this._audioL.currentTime = 0;
      this._audioR.currentTime = 0;
    }
    this._audioL.play().catch(() => {});
    this._audioR.play().catch(() => {});
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '▶ Playing';
    this._startSeekUpdate();
  }

  _playbackPause() {
    if (!this._playbackReady) return;
    this._audioL.pause();
    this._audioR.pause();
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '⏸ Paused';
    this._stopSeekUpdate();
  }

  _playbackStop() {
    if (!this._playbackReady) return;
    this._audioL.pause();
    this._audioR.pause();
    this._audioL.currentTime = 0;
    this._audioR.currentTime = 0;
    if (this.els.seekSlider) this.els.seekSlider.value = 0;
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '⏹ Stopped';
    if (this.els.transportTime) this.els.transportTime.textContent = `0:00 / ${this._fmtTime(this._playbackDuration)}`;
    this._stopSeekUpdate();
  }

  _startSeekUpdate() {
    const update = () => {
      const t = this._audioL.currentTime || 0;
      const d = this._playbackDuration || 1;
      if (this.els.seekSlider) this.els.seekSlider.value = (t / d * 100).toFixed(1);
      if (this.els.transportTime) this.els.transportTime.textContent = `${this._fmtTime(t)} / ${this._fmtTime(d)}`;
      // Sync R to L if drifted
      if (Math.abs(this._audioR.currentTime - t) > 0.1) this._audioR.currentTime = t;
      if (!this._audioL.paused) this._seekAnimFrame = requestAnimationFrame(update);
    };
    this._seekAnimFrame = requestAnimationFrame(update);
  }

  _stopSeekUpdate() {
    if (this._seekAnimFrame) cancelAnimationFrame(this._seekAnimFrame);
  }

  _fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  _clearPlayback() {
    this._playbackStop();
    this._audioL.src = '';
    this._audioR.src = '';
    this._playbackDuration = 0;
    this.els.playbackFileName.textContent = '--';
    this.els.dropZone.style.display = '';
    this.els.playbackPlayer.style.display = 'none';
    this.els.playbackFileInput.value = '';
    if (this.els.statusPlayback) this.els.statusPlayback.textContent = '--';
  }
}

// ── Initialize on DOM ready ──
document.addEventListener('DOMContentLoaded', () => {
  window.emsApp = new EMSProminenceApp();
  window.emsApp.init();
});
