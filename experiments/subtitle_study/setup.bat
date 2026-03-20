@echo off
REM setup.bat — Environment setup for subtitle study pipeline
REM Run this once from experiments\subtitle_study\

echo === Subtitle Study Pipeline Setup ===

REM Create venv if not exists
if not exist ".venv" (
    echo Creating Python virtual environment...
    python -m venv .venv
)

echo Activating venv...
call .venv\Scripts\activate.bat

echo Installing dependencies...
pip install --upgrade pip
pip install numpy scipy soundfile librosa
pip install spacy
python -m spacy download en_core_web_sm
pip install whisper-timestamped
pip install openai-whisper
pip install pandas tqdm
pip install yt-dlp

echo.
echo === Setup complete ===
echo Activate with: .venv\Scripts\activate.bat
echo Then run: python run_all.py
