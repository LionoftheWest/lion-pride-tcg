@echo off
rem Opens the Card Studio (port 4321) to your Tailscale devices ONLY
rem (the 100.64.0.0/10 range). Run once. It will ask for administrator rights.
net session >nul 2>&1
if %errorLevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Card Studio Tailscale" >nul 2>&1
netsh advfirewall firewall add rule name="Card Studio Tailscale" dir=in action=allow protocol=TCP localport=4321 remoteip=100.64.0.0/10
echo.
echo Done. Your phone (on Tailscale) can now reach the studio at:
echo    http://nathan-gaming.taila63521.ts.net:4321
echo.
pause
