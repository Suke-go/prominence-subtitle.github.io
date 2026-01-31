@echo off
echo ========================================
echo   Prominence Subtitle - Full Stack
echo   (Frontend + Google Cloud STT Server)
echo ========================================
echo.

:: Check if server/.env exists
if not exist "server\.env" (
    echo ERROR: server\.env not found!
    echo.
    echo Please configure Google Cloud credentials:
    echo   1. cd server
    echo   2. copy .env.example .env
    echo   3. Edit .env with your credentials
    echo.
    pause
    exit /b 1
)

:: Start frontend server in background
echo Starting frontend server...
start "Frontend" cmd /c "python -m http.server 8080"

:: Wait a moment
timeout /t 2 /nobreak >nul

:: Start STT server
echo Starting Google Cloud STT server...
cd server
call npm install >nul 2>nul
start "" "http://localhost:8080"
npm start
