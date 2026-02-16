/**
 * Prominence Subtitle - Backend Proxy Server
 * Bridges browser audio to Google Cloud Speech-to-Text API
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('../')); // Serve frontend files

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Google Cloud Speech client
let speechClient = null;

try {
    speechClient = new speech.SpeechClient();
    console.log('[STT] Google Cloud Speech client initialized');
} catch (error) {
    console.error('[STT] Failed to initialize Speech client:', error.message);
    console.error('[STT] Make sure GOOGLE_APPLICATION_CREDENTIALS is set');
}

// Store active recognition streams per client
const activeStreams = new Map();

/**
 * Handle WebSocket connections
 */
wss.on('connection', (ws, req) => {
    const clientId = Date.now().toString();
    console.log(`[WS] Client connected: ${clientId}`);

    let recognizeStream = null;
    let streamingConfig = null;

    ws.on('message', (message) => {
        try {
            // Check if it's a control message (JSON) or audio data (binary)
            if (typeof message === 'string' || message instanceof Buffer && message[0] === 123) {
                const data = JSON.parse(message.toString());
                handleControlMessage(ws, clientId, data);
            } else {
                // Binary audio data
                handleAudioData(ws, clientId, message);
            }
        } catch (error) {
            console.error(`[WS] Error processing message:`, error);
        }
    });

    ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${clientId}`);
        stopRecognition(clientId);
    });

    ws.on('error', (error) => {
        console.error(`[WS] WebSocket error:`, error);
    });

    /**
     * Handle control messages (start, stop, config)
     */
    function handleControlMessage(ws, clientId, data) {
        switch (data.type) {
            case 'start':
                startRecognition(ws, clientId, data.config);
                break;
            case 'stop':
                stopRecognition(clientId);
                break;
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
            default:
                console.log(`[WS] Unknown message type: ${data.type}`);
        }
    }

    /**
     * Handle incoming audio data
     */
    function handleAudioData(ws, clientId, audioBuffer) {
        const stream = activeStreams.get(clientId);
        if (stream && stream.recognizeStream) {
            stream.recognizeStream.write(audioBuffer);
        }
    }

    /**
     * Start speech recognition stream
     */
    function startRecognition(ws, clientId, config = {}) {
        if (!speechClient) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Speech client not initialized. Check server configuration.'
            }));
            return;
        }

        // Stop existing stream if any
        stopRecognition(clientId);

        const streamingConfig = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: config.sampleRate || 16000,
                languageCode: config.language || 'en-US',
                enableWordTimeOffsets: true,      // KEY: Get word timestamps
                enableWordConfidence: true,
                enableAutomaticPunctuation: true,
                model: 'default',
            },
            interimResults: true,  // Get interim results for real-time display
        };

        console.log(`[STT] Starting recognition for ${clientId}:`, streamingConfig.config.languageCode);

        const recognizeStream = speechClient.streamingRecognize(streamingConfig)
            .on('error', (error) => {
                console.error(`[STT] Recognition error:`, error);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: error.message
                }));
                stopRecognition(clientId);
            })
            .on('data', (response) => {
                handleRecognitionResult(ws, response);
            });

        activeStreams.set(clientId, { recognizeStream, ws });

        ws.send(JSON.stringify({ type: 'started' }));
    }

    /**
     * Stop recognition stream
     */
    function stopRecognition(clientId) {
        const stream = activeStreams.get(clientId);
        if (stream) {
            if (stream.recognizeStream) {
                stream.recognizeStream.end();
            }
            activeStreams.delete(clientId);
            console.log(`[STT] Stopped recognition for ${clientId}`);
        }
    }

    /**
     * Handle recognition results from Google Cloud
     */
    function handleRecognitionResult(ws, response) {
        if (!response.results || response.results.length === 0) return;

        for (const result of response.results) {
            if (!result.alternatives || result.alternatives.length === 0) continue;

            const alternative = result.alternatives[0];

            // Extract word-level timing information
            const words = [];
            if (alternative.words) {
                for (const wordInfo of alternative.words) {
                    words.push({
                        word: wordInfo.word,
                        startTime: parseTimeOffset(wordInfo.startTime),
                        endTime: parseTimeOffset(wordInfo.endTime),
                        confidence: wordInfo.confidence || 0
                    });
                }
            }

            // Send result to client
            ws.send(JSON.stringify({
                type: 'result',
                transcript: alternative.transcript,
                words: words,
                isFinal: result.isFinal,
                confidence: alternative.confidence || 0
            }));
        }
    }

    /**
     * Parse Google's time offset format to milliseconds
     */
    function parseTimeOffset(timeOffset) {
        if (!timeOffset) return 0;
        const seconds = parseInt(timeOffset.seconds || 0);
        const nanos = parseInt(timeOffset.nanos || 0);
        return seconds * 1000 + nanos / 1000000;
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        speechClient: speechClient !== null,
        activeConnections: wss.clients.size
    });
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        ready: speechClient !== null,
        message: speechClient ? 'Speech-to-Text API ready' : 'API credentials not configured'
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Prominence Subtitle Server`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`  WebSocket: ws://localhost:${PORT}`);
    console.log(`  Speech API: ${speechClient ? '✓ Ready' : '✗ Not configured'}`);
    console.log(`========================================\n`);
});
