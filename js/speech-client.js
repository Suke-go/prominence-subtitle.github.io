/**
 * Speech Client - WebSocket connection to backend Speech-to-Text server
 * Provides word-level timestamps for accurate prominence alignment
 */

class SpeechClient {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'ws://localhost:3001';
        this.language = options.language || 'en-US';
        this.sampleRate = options.sampleRate || 16000;

        // Callbacks
        this.onResult = options.onResult || (() => { });
        this.onError = options.onError || (() => { });
        this.onStatusChange = options.onStatusChange || (() => { });

        // State
        this.ws = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;

        // Audio resampling
        this.targetSampleRate = 16000; // Google STT optimal
    }

    /**
     * Connect to the backend server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            this.onStatusChange('connecting');

            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    console.log('[SpeechClient] Connected to server');
                    this.isConnected = true;
                    this.onStatusChange('connected');
                    resolve(true);
                };

                this.ws.onclose = () => {
                    console.log('[SpeechClient] Disconnected from server');
                    this.isConnected = false;
                    this.isStreaming = false;
                    this.onStatusChange('disconnected');
                };

                this.ws.onerror = (error) => {
                    console.error('[SpeechClient] WebSocket error:', error);
                    this.onError('WebSocket connection failed');
                    this.onStatusChange('disconnected');
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };

            } catch (error) {
                console.error('[SpeechClient] Connection error:', error);
                this.onStatusChange('disconnected');
                reject(error);
            }
        });
    }

    /**
     * Handle incoming messages from server
     */
    handleMessage(data) {
        switch (data.type) {
            case 'result':
                // Word-level results with timestamps
                this.onResult({
                    transcript: data.transcript,
                    words: data.words,  // Array of {word, startTime, endTime, confidence}
                    isFinal: data.isFinal,
                    confidence: data.confidence
                });
                break;

            case 'started':
                console.log('[SpeechClient] Recognition started');
                this.isStreaming = true;
                break;

            case 'error':
                console.error('[SpeechClient] Server error:', data.message);
                this.onError(data.message);
                break;

            case 'pong':
                // Keep-alive response
                break;
        }
    }

    /**
     * Start streaming audio to server
     */
    async startStreaming() {
        if (!this.isConnected) {
            throw new Error('Not connected to server');
        }

        try {
            // Get microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.targetSampleRate,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Create audio context for processing
            this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create processor for audio chunks
            // Note: ScriptProcessorNode is deprecated but works for now
            // TODO: Migrate to AudioWorklet
            const bufferSize = 4096;
            this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            this.processor.onaudioprocess = (e) => {
                if (!this.isStreaming || !this.isConnected) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // Convert Float32 to Int16 (LINEAR16 format for Google STT)
                const int16Data = this.float32ToInt16(inputData);

                // Send audio data to server
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(int16Data.buffer);
                }
            };

            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            // Tell server to start recognition
            this.ws.send(JSON.stringify({
                type: 'start',
                config: {
                    language: this.language,
                    sampleRate: this.targetSampleRate
                }
            }));

            console.log('[SpeechClient] Streaming started');
            return true;

        } catch (error) {
            console.error('[SpeechClient] Failed to start streaming:', error);
            this.onError('Microphone access failed: ' + error.message);
            return false;
        }
    }

    /**
     * Convert Float32 audio samples to Int16
     */
    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            // Clamp and convert
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    /**
     * Stop streaming
     */
    stopStreaming() {
        this.isStreaming = false;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'stop' }));
        }

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        console.log('[SpeechClient] Streaming stopped');
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        this.stopStreaming();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
    }

    /**
     * Set language
     */
    setLanguage(language) {
        this.language = language;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpeechClient;
}
