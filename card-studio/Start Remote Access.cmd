@echo off
title Card Studio - Remote Access (permanent URL)
cd /d "%~dp0"
echo ============================================================
echo   Card Studio - Remote Access
echo.
echo   Permanent URL:  https://studio.lionpridetcg.duckdns.org
echo   Login:          your STUDIO_USER / STUDIO_PASS (from .env)
echo.
echo   Keep the normal "Card Studio" window running too.
echo   Close THIS window to turn remote access off.
echo ============================================================
echo.
echo Starting the password gate on 4322...
start "studio-gate" /min cmd /c "node src\remote-proxy.js"
timeout /t 2 >nul
echo Connecting the secure tunnel to your VM. Keep this window open.
echo (It reconnects by itself if the connection drops.)
echo.
:loop
ssh -i "%USERPROFILE%\Downloads\ssh-key-2026-09-08.key" ^
    -o StrictHostKeyChecking=accept-new ^
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ^
    -o ExitOnForwardFailure=yes ^
    -N -R 127.0.0.1:4399:localhost:4322 ubuntu@129.146.118.111
echo.
echo Tunnel closed or dropped. Reconnecting in 5 seconds... (press Ctrl+C to stop)
timeout /t 5 >nul
goto loop
