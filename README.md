# Prominence Subtitle

Real-time speech-to-subtitle system with **prosodic prominence detection**. Words are dynamically sized based on acoustic stress—stressed words appear larger, creating more expressive and accessible captions.

![Demo](https://img.shields.io/badge/Demo-Live-brightgreen)

## Features

- 🎤 **Real-time speech recognition** with two modes:
  - Browser (Web Speech API) - works offline
  - Server (Google Cloud STT) - word-level timestamps
- 📊 **Acoustic prominence detection** via WebAssembly
- 📝 **Dynamic font sizing** based on WCAG guidelines (12pt/18pt/24pt)
- 🎥 **Webcam overlay** for video conferencing style display
- 🎚️ **Adjustable sensitivity** and voice calibration

## Quick Start (Browser Mode)

**No server required!** Just open in Chrome:

### Option 1: GitHub Pages
Visit: https://suke-go.github.io/prominence-subtitle.github.io/

### Option 2: Local
```powershell
# Clone and serve
git clone https://github.com/Suke-go/prominence-subtitle.github.io.git
cd prominence-subtitle.github.io

# Using Python
python -m http.server 8080

# Or using Node.js
npx serve .
```

Then open http://localhost:8080 in Chrome.

## Advanced: Server Mode (Google Cloud STT)

For more accurate word-level timestamps:

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable **Cloud Speech-to-Text API**
4. Create Service Account → Download JSON key

### 2. Server Configuration

```powershell
cd server

# Create .env file
copy .env.example .env

# Edit .env - set path to your JSON key:
# GOOGLE_APPLICATION_CREDENTIALS=./your-key.json

# Install and run
npm install
npm start
```

### 3. Usage

1. Open http://localhost:8080
2. Select "☁️ Server (Google Cloud STT)" mode
3. Click "Connect to Server"
4. Speak!

## Controls

| Control | Description |
|---------|-------------|
| **STT Mode** | Switch between Browser/Server |
| **Language** | English (US/UK), Japanese |
| **Base Size** | Base font size (12-48px) |
| **Sensitivity** | Prominence detection sensitivity |
| **🔄 Recalibrate** | Reset noise floor calibration |
| **🎤 Voice Calibrate** | Calibrate to your voice range |
| **Debug Info** | Show real-time metrics |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Microphone │─▶│ Prominence   │─▶│  Subtitle  │ │
│  │   Audio     │  │ Detector     │  │  Renderer  │ │
│  └─────────────┘  │ (Wasm)       │  └────────────┘ │
│        │          └──────────────┘        ▲        │
│        │                                  │        │
│        ▼                                  │        │
│  ┌─────────────────────────────────────────────┐   │
│  │  Speech Recognition                         │   │
│  │  ├─ Browser: Web Speech API                 │   │
│  │  └─ Server:  WebSocket → Google Cloud STT   │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Technical Details

### Prominence Detection

Uses a WebAssembly module (`libsyllable`) that analyzes:
- Pitch contour
- Energy envelope  
- Spectral flux

Outputs a prominence score (0-1) for each detected syllable.

### Alignment Strategy

**Interim-Only Mode**: Prominence scores are calculated during interim (real-time) results and preserved when finalized. This avoids timing drift that occurs when recalculating at finalization.

## File Structure

```
prominence-subtitle/
├── index.html          # Main page
├── css/style.css       # Styling
├── js/
│   ├── prominence-subtitle.js  # Main application
│   └── speech-client.js        # WebSocket STT client
├── wasm/
│   └── syllable.js     # Wasm loader
├── server/             # Optional Google Cloud STT proxy
│   ├── index.js
│   ├── package.json
│   └── README.md
└── README.md           # This file
```

## Browser Support

- ✅ Chrome (recommended)
- ✅ Edge
- ⚠️ Firefox (limited Web Speech API)
- ❌ Safari (no Web Speech API)

## License

MIT
