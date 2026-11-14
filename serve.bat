@echo off
rem CHRONO-SAR local server: double-click to open the site on http://localhost:8080
rem Extra options are passed through, e.g.  serve.bat --lan   (share on your Wi-Fi)
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node tools\serve.mjs --watch %*
) else (
  echo Node.js was not found - starting Python's built-in server instead.
  echo Open http://localhost:8080/ in your browser. Press Ctrl+C to stop.
  start "" "http://localhost:8080/"
  python -m http.server 8080 --bind 127.0.0.1 --directory dist
)
pause
