@echo off
title Card Studio
cd /d "%~dp0"
echo ================================================
echo   Card Studio  -  http://localhost:4321
echo   Keep this window open. Close it to stop.
echo ================================================
echo.
rem Open the browser a moment after the server starts.
start "" /min powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://localhost:4321'"
node src/server.js
echo.
echo Card Studio stopped. Press any key to close.
pause >nul
