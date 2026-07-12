# TradeBobby Desktop

A thin desktop control panel around the existing Node dashboard. One click launches the
dashboard **and all 19 daemons**, shows the dashboard in a window, and puts a tray icon in
the menu bar with start / stop / restart / status -- no terminal needed.

It does **not** reimplement anything: it runs `../dashboard/manage.sh` under the hood.

## Install (macOS)

1. Open `dist/TradeBobby-1.0.0-arm64.dmg`
2. Drag **TradeBobby** to Applications
3. First launch: right-click the app -> **Open** (it's unsigned, so Gatekeeper asks once)
4. It starts everything and opens the dashboard. The menu-bar icon stays for control.

The app finds the dashboard automatically. If the repo ever moves, it asks you to locate the
`dashboard/` folder once and remembers it (or set `TB_DASH_DIR=/path/to/dashboard`).

## Tray menu

- **Open Dashboard** / **Open Live Orderflow**
- **Start all** / **Restart all** / **Stop all daemons**
- **Refresh status** -- shows `● N up / M down`
- **Locate dashboard folder...**
- **Quit (leave daemons running)** -- closes the window, data keeps flowing
- **Stop all & Quit** -- full shutdown

Closing the window hides to the tray (daemons keep running).

## Launch at login (optional)

System Settings -> General -> Login Items -> **+** -> add TradeBobby. Then the whole system
comes back automatically after every reboot / wake, on top of the 2-minute watchdog.

## Rebuild

```bash
cd desktop
npm install
node gen-icons.js          # regenerate icons (only if you change the design)
npm run dist:mac           # -> dist/*.dmg + .app
npm run dist:win           # Windows .exe (needs wine on macOS, or run on Windows)
```

## How it works

`main.js`: on launch -> `manage.sh start` -> poll `http://localhost:3333` -> open a
BrowserWindow on the dashboard. `manage.sh` resolves node's PATH itself, so it works even
though Finder-launched apps get a minimal PATH without node.
