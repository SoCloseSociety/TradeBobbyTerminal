@echo off
REM ── TradeBobby launcher (Windows) ──────────────────────────────────────────
REM IMPORTANT: the live stack (Chrome CDP + TradingView engine) currently runs
REM on the Mac. This script is for a FUTURE Windows install: it assumes this
REM repo is cloned locally, Node 18+ is on PATH, and Chrome is installed.
REM The dashboard binds to 127.0.0.1 only (no auth) -- do NOT expose it on a network.

set DASH=%~dp0dashboard
set PROFILE=%USERPROFILE%\.chrome-debug-profile

REM 1. Chrome with CDP for the TradingView engine (log into TradingView once)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" "https://www.tradingview.com/chart/"

REM 2. Dashboard server
cd /d "%DASH%"
start /B node server.js > "%TEMP%\tb-dashboard.log" 2>&1

REM 3. Scanner daemons (same list as manage.sh)
for %%d in (macro-pulse crypto-pulse orderflow-crypto news-scanner cot-fetcher onchain-btc earnings-cal setup-tracker currency-strength reddit-mania setup-alerter trade-agent etf-flows claude-narrator tts-narrator weekly-brief auto-scan econ-calendar) do (
  start /B node %%d.js --daemon > %%d.log 2>&1
)

REM 4. Open the live view once the server answers
timeout /t 5 /nobreak > nul
start "" "http://localhost:3333/live"
