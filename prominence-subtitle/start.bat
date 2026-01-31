@echo off
echo ========================================
echo   Prominence Subtitle - Local Server
echo ========================================
echo.

:: Check if Python is available
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Starting server with Python...
    echo.
    echo Open in Chrome: http://localhost:8080
    echo Press Ctrl+C to stop
    echo.
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto :end
)

:: Check if Node.js is available
where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Starting server with npx serve...
    echo.
    echo Open in Chrome: http://localhost:8080
    echo Press Ctrl+C to stop
    echo.
    start "" "http://localhost:8080"
    npx serve . -l 8080
    goto :end
)

echo ERROR: Python or Node.js required!
echo.
echo Install one of:
echo   - Python: https://www.python.org/downloads/
echo   - Node.js: https://nodejs.org/
pause

:end
