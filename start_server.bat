@echo off
REM AIR Controller - Server Setup & Launch Script (Windows)

echo.
echo ==================================
echo    AIR Controller - Setup
echo ==================================
echo.

REM Check Python
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Python 3 is required but not installed.
    echo Install from: https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo Found: %%i

REM Create virtual environment if needed
if not exist "server\venv" (
    echo Creating virtual environment...
    python -m venv server\venv
)

REM Activate virtual environment
call server\venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r server\requirements.txt --quiet

REM Install ViGEmBus driver check
echo.
echo NOTE: Windows requires ViGEmBus driver for virtual controllers.
echo If not installed, download from:
echo https://github.com/nefarius/ViGEmBus/releases
echo.

echo Setup complete! Starting server...
echo.

REM Run server
python server\server.py

pause
