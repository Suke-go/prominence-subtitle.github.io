# Prominence Subtitle - Google Cloud STT Server

Backend proxy server for Google Cloud Speech-to-Text with word-level timestamps.

## Setup

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Cloud Speech-to-Text API**
4. Create a **Service Account**:
   - Go to IAM & Admin → Service Accounts
   - Create Service Account
   - Grant "Cloud Speech Client" role
   - Create JSON key and download it

### 2. Server Configuration

```bash
cd server

# Copy environment template
copy .env.example .env

# Edit .env and set your credentials path:
# GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
```

Place your downloaded JSON key file in the `server/` directory and name it `service-account-key.json`.

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Server

```bash
npm start
```

Server will start at `http://localhost:3001`

## Usage

1. Open the frontend (`index.html`) in Chrome
2. Click **"Connect to Server"** button
3. Allow microphone access
4. Speak in English - words will be transcribed with timestamp-aligned prominence

## API Response Format

```json
{
  "type": "result",
  "transcript": "The quick brown fox",
  "words": [
    { "word": "The", "startTime": 100, "endTime": 300, "confidence": 0.95 },
    { "word": "quick", "startTime": 300, "endTime": 600, "confidence": 0.98 },
    ...
  ],
  "isFinal": true,
  "confidence": 0.97
}
```

## Troubleshooting

### "Speech client not initialized"
- Check that `GOOGLE_APPLICATION_CREDENTIALS` is set correctly in `.env`
- Make sure the JSON key file exists and is valid

### WebSocket connection failed
- Ensure server is running on port 3001
- Check firewall settings
