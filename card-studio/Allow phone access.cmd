@echo off
rem Opens TCP port 4321 on your PRIVATE (home) network so your phone can reach
rem the Card Studio over Wi-Fi. Run once. It will ask for administrator rights.
net session >nul 2>&1
if %errorLevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Card Studio 4321" >nul 2>&1
netsh advfirewall firewall add rule name="Card Studio 4321" dir=in action=allow protocol=TCP localport=4321 profile=private
echo.
echo Done. On the same Wi-Fi, open the studio on your phone at:
echo    http://10.0.0.96:4321
echo (Keep the Card Studio window open on this PC.)
echo.
pause
