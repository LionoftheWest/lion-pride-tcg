@echo off
title Card Studio - Remote Access
cd /d "%~dp0"
echo ============================================================
echo   Card Studio - Remote Access (phone from anywhere)
echo   Make sure the normal "Card Studio" window is running too.
echo   Login:  nathan   /   (your STUDIO_PASS in the .env file)
echo   Keep this window open. Close it to turn remote access off.
echo ============================================================
echo.
echo Starting the password gate...
start "studio-proxy" /min cmd /c "node src\remote-proxy.js"
timeout /t 2 >nul
echo Starting the secure tunnel - your phone URL appears below:
echo.
cloudflared.exe tunnel --url http://localhost:4322 --no-autoupdate
