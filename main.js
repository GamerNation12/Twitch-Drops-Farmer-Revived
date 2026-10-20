const { app, BrowserWindow, session, ipcMain, Tray, Menu, nativeImage, shell, clipboard } = require('electron')
const path = require('node:path')
const fs = require('fs')
const { spawn } = require('node:child_process')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const crypto = require('node:crypto')

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// LOCAL PATCH: copy text (e.g. the activation code) to the system clipboard
ipcMain.handle('copy-to-clipboard', (event, text) => {
  try {
    clipboard.writeText(String(text == null ? '' : text));
    return true;
  } catch (e) {
    return false;
  }
});
const TwitchWebSocketManager = require('./websocket-manager')
const GraphQLManager = require('./gql-manager')
const DiscordRPCManager = require('./discord-rpc-manager')

process.on('uncaughtException', (err) => {
  console.error('Core: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Core: Unhandled Rejection:', reason);
});

// Basic optimization flags
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('disable-webgl');
app.commandLine.appendSwitch('disable-webgl2');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('log-level', '3'); // Show only fatal errors to keep console clean

// Managers
const gql = new GraphQLManager();
const wsManager = new TwitchWebSocketManager();
const rpc = new DiscordRPCManager('1513780136728596640');

// Campaign Cache
let inventoryCache = { data: null, timestamp: 0, ttl: 20000 };

let mainWindow;
let tray = null;
let trayBalloonShown = false;   // local patch: only balloon once per run
let isQuitting = false;

// LOCAL PATCH: one place for the display name shown by the tray and the
// sign-in window (the repo/product is "Drops Farmer Revived" now).
const BRAND_NAME = 'Drops Farmer Revived';

/**
 * Build standard Twitch GQL headers including optional Integrity and Device-Id
 */
function buildHeaders(tokens) {
  const headers = {
    // LOCAL PATCH: this is the *web* client id, not the TV one. Every query
    // this app sends (ViewerDropsDashboard, Inventory, ...) is a web-client
    // query; sending them with the TV client id makes Twitch answer
    // dropCampaigns: null without any error, which looks like "no campaigns".
    'Client-Id': tokens.clientId || 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    'Authorization': tokens.auth,
    'Content-Type': 'application/json'
  };
  if (tokens.integrity) headers['Client-Integrity'] = tokens.integrity;
  if (tokens.deviceId) {
    headers['Device-Id'] = tokens.deviceId;
    headers['X-Device-Id'] = tokens.deviceId;
  }
  return headers;
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets/icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkoBAwUqifAWowf//+P8MIGEQUvH/fGEYDGBkhY0ZDYDBR8P99Y7CHAACOWSAFAgsPhQAAAABJRU5ErkJggg==');
  }

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Quit', click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(BRAND_NAME);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    // LOCAL PATCH: restore from a normal minimise before toggling visibility,
    // otherwise clicking the tray icon of a minimised window just hid it.
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

ipcMain.on('update-tray-tooltip', (event, text) => {
  if (tray) {
    tray.setToolTip(`${BRAND_NAME}\n${text}`);
  }
});

ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// LOCAL PATCH: real window controls. The native title bar is hidden and the
// titleBarOverlay buttons were sat under the app's own header, so the app draws
// its own minimise / maximise / close buttons and wires them to these.
ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window-maximize-toggle', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

// The labelled "Background" button: hide to the tray, keep farming.
ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  // Windows: tell the user where the app went, once per run.
  if (process.platform === 'win32' && tray && !trayBalloonShown) {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({
        title: `${BRAND_NAME} is still running`,
        content: 'Moved to the tray - farming continues. Click the tray icon to reopen, or right-click it to quit.'
      });
    } catch (e) { /* balloons are best-effort */ }
  }
});

// LOCAL PATCH: the X button (and Alt+F4 / the taskbar's Close) really quits the
// app now. It used to hide to the tray, which made the X look broken - keeping
// the app alive in the background is what the "Background" button is for.
ipcMain.on('window-quit', () => {
  isQuitting = true;
  app.quit();
});

const configPath = path.join(app.getPath('userData'), 'app-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(cfg) {
  try {
    const existing = loadConfig();
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...cfg }), 'utf8');
  } catch (e) {}
}

ipcMain.handle('get-auto-launch', () => {
  try {
    const settings = app.getLoginItemSettings();
    const config = loadConfig();

    // One-time migration: older builds forced this off unless "launch with
    // Windows" was enabled, so every existing install has false saved even
    // though the user never turned it off. Flip it on once, then respect the
    // user's choice from then on.
    let autoStartFarm = typeof config.autoStartFarm === 'boolean' ? config.autoStartFarm : true;
    if (config.autoStartFarmMigrated !== true) {
      autoStartFarm = true;
      saveConfig({ autoStartFarmMigrated: true, autoStartFarm: true });
    }

    return {
      autoLaunchEnabled: typeof config.autoLaunchEnabled === 'boolean' ? config.autoLaunchEnabled : settings.openAtLogin,
      autoLaunchHidden: typeof config.autoLaunchHidden === 'boolean' ? config.autoLaunchHidden : settings.openAsHidden,
      // LOCAL PATCH: farming on launch is its own setting now (it used to be
      // locked behind "launch with Windows") and defaults to ON, so a fresh
      // install starts working through the priority list by itself.
      autoStartFarm,
      autoStartFarmMode: config.autoStartFarmMode || 'priority'
    };
  } catch (e) {
    return { autoLaunchEnabled: false, autoLaunchHidden: false, autoStartFarm: true, autoStartFarmMode: 'priority' };
  }
});

ipcMain.handle('set-auto-launch', (event, cfg) => {
  try {
    saveConfig({
      autoLaunchEnabled: !!cfg.autoLaunchEnabled,
      autoLaunchHidden: !!cfg.autoLaunchHidden,
      autoStartFarm: !!cfg.autoStartFarm,
      autoStartFarmMode: cfg.autoStartFarmMode || 'priority',
      autoStartFarmMigrated: true
    });

    const opts = {
      openAtLogin: !!cfg.autoLaunchEnabled,
      openAsHidden: !!cfg.autoLaunchHidden
    };
    if (!app.isPackaged) {
      opts.path = process.execPath;
      opts.args = [path.resolve(process.argv[1])];
      if (cfg.autoLaunchHidden) opts.args.push('--hidden');
    } else {
      opts.args = cfg.autoLaunchHidden ? ['--hidden'] : [];
    }
    app.setLoginItemSettings(opts);
    return { success: true };
  } catch (e) {
    console.error('Error setting auto launch settings:', e);
    return { success: false, error: e.message };
  }
});

// ============================================================
// Window
// ============================================================
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1080,
    minHeight: 700,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      // LOCAL PATCH: the farming loop, campaign refresh and auto-claim live in
      // this renderer, and the window is expected to spend its life hidden in
      // the tray. Without this Chromium throttles those timers to about once a
      // minute and "farming in the background" crawls.
      backgroundThrottling: false
    },
    titleBarStyle: 'hidden',
    backgroundColor: '#0e0e10',
    show: false
  })

  const config = loadConfig();
  const isHiddenLaunch = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden || config.autoLaunchHidden === true;

  mainWindow.once('ready-to-show', () => {
    if (!isHiddenLaunch) {
      mainWindow.show();
      mainWindow.focus();
    }
  })

  // Fallback if ready-to-show is delayed
  setTimeout(() => {
    if (!isHiddenLaunch && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 2000)

  // LOCAL PATCH: minimising behaves like any other window (stays in the
  // taskbar). Closing really closes: the header's X quits the app, and the
  // separate "Background" button hides it to the tray while farming continues.
  // app.quit() is explicit here because the hidden farm/claim windows would
  // otherwise keep the process alive after the main window is gone.
  mainWindow.on('close', () => {
    isQuitting = true;
    setImmediate(() => app.quit());
  });

  mainWindow.loadFile('index.html')

let lastCapturedAuth = '';
let lastCapturedIntegrity = '';

// Intercept Twitch GQL traffic for token capture
session.defaultSession.webRequest.onBeforeSendHeaders(
  { urls: ['*://gql.twitch.tv/gql'] },
  (details, callback) => {
    let auth = details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
    let integrity = details.requestHeaders['Client-Integrity'] || details.requestHeaders['client-integrity'];
    let clientId = details.requestHeaders['Client-Id'] || details.requestHeaders['client-id'];
    let deviceId = details.requestHeaders['X-Device-Id'] || details.requestHeaders['Device-Id'] || details.requestHeaders['device-id'];

    if ((auth && auth.includes('OAuth')) || integrity) {
      lastCaptureAt = Date.now();
      if (autoAuthWin && !autoAuthWin.isDestroyed()) {
        setTimeout(() => {
          if (autoAuthWin && !autoAuthWin.isDestroyed()) {
            autoAuthWin.destroy();
            autoAuthWin = null;
          }
        }, 1500);
      }
      if (isRefreshingToken && integrity) {
        tokenCapturedDuringRefresh = true;
        console.log('[IntegrityBot] Captured new integrity token successfully!');
        if (refreshWin && !refreshWin.isDestroyed()) {
          setTimeout(() => {
            if (refreshWin && !refreshWin.isDestroyed()) {
              refreshWin.destroy();
              refreshWin = null;
            }
            isRefreshingToken = false;
            if (integrityRefreshTimer) clearTimeout(integrityRefreshTimer);
          }, 500);
        }
      }
      
      // Deduplicate: only notify mainWindow if tokens actually changed
      if ((auth && auth !== lastCapturedAuth) || (integrity && integrity !== lastCapturedIntegrity)) {
        if (auth) lastCapturedAuth = auth;
        if (integrity) lastCapturedIntegrity = integrity;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth-token-captured', { auth, integrity, clientId, deviceId });
        }
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  }
);
}

// LOCAL PATCH: only one copy of the miner may run at a time. Previously,
// clicking a pinned taskbar icon while the app sat in the tray started a second
// instance (two miners, two farm windows, same account). Now the second launch
// just brings the existing window back.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // The user clicked the app icon again (taskbar/tray shortcut/start menu).
    // Bring the running window back instead of running a second miner.
    console.log('[SingleInstance] second launch detected - restoring the running window');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// A portable self-update renames the running exe to <name>.old and puts the new
// build in its place. The old launcher keeps that file open until it exits, so it
// can only be deleted on the next start.
function cleanupOldPortableExe() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!portable) return;
  const backup = portable + '.old';
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    try {
      fs.unlinkSync(backup);
      clearInterval(timer);
    } catch (e) {
      if (e.code === 'ENOENT' || tries > 20) clearInterval(timer);
    }
  }, 500);
  if (timer.unref) timer.unref();
}

// A silent installed update leaves the downloaded Setup in
// %TEMP% - the installer is using the file while it runs, so it cannot delete
// itself. Clear anything old that a previous update left behind.
function cleanupTempUpdateFiles() {
  const temp = app.getPath('temp');
  const now = Date.now();
  let names = [];
  try { names = fs.readdirSync(temp); } catch (e) { return; }
  for (const name of names) {
    if (!/^DropsFarmerRevived_.*\.exe$/i.test(name) && !/^dfr-updater-.*\.js$/i.test(name)) continue;
    const full = path.join(temp, name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs < 10 * 60 * 1000) continue; // may still be in use
      fs.unlinkSync(full);
    } catch (e) {}
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  cleanupOldPortableExe();
  cleanupTempUpdateFiles();
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  wsManager.disconnect();
  if (process.platform !== 'darwin') app.quit()
})

/**
 * IPC Handlers for Device Authorization Flow & Twitch GraphQL operations
 */

ipcMain.handle('request-device-code', async () => {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=ue6666qo983tsx6so1t0vnawi233wa&scopes=user:read:email'
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('poll-device-token', async (event, deviceCode) => {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=ue6666qo983tsx6so1t0vnawi233wa&device_code=${encodeURIComponent(deviceCode)}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

// ============================================================
// LOCAL PATCH: update check against this fork's GitHub releases
// The renderer asks for this; the request has to happen here because the
// GitHub API requires a User-Agent header, which the renderer cannot set.
// ============================================================
const UPDATE_REPO = 'GamerNation12/Twitch-Drops-Farmer-Revived';

function semverParts(v) {
  return String(v || '').replace(/^v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
}

function semverNewer(candidate, current) {
  const a = semverParts(candidate);
  const b = semverParts(current);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: {
        'User-Agent': 'Twitch-Drops-Farmer-Revived',
        'Accept': 'application/vnd.github+json'
      }
    });

    if (res.status === 404) {
      // Repo exists but no release published yet.
      return { currentVersion, latestVersion: currentVersion, hasUpdate: false, reason: 'no-releases' };
    }
    if (!res.ok) {
      return { currentVersion, error: `GitHub API returned ${res.status}` };
    }

    const release = await res.json();
    const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    // Releases carry two exes: the portable one and the NSIS Setup. Pick the one
    // this build can actually use (see updateMode()).
    const exeAssets = (release.assets || []).filter((a) => /\.exe$/i.test(a.name));
    const setupAsset = exeAssets.find((a) => /setup/i.test(a.name));
    const portableAsset = exeAssets.find((a) => !/setup/i.test(a.name));
    const wantInstaller = updateMode().mode === 'installed';
    const asset = (wantInstaller ? setupAsset || portableAsset : portableAsset || setupAsset);

    return {
      currentVersion,
      latestVersion,
      hasUpdate: semverNewer(latestVersion, currentVersion),
      releaseUrl: release.html_url,
      downloadUrl: asset ? asset.browser_download_url : release.html_url,
      // GitHub publishes sha256:<hex> for release assets; the updater verifies
      // the download against it before touching the installed exe.
      digest: (asset && asset.digest) || null,
      assetSize: (asset && asset.size) || null,
      assetName: (asset && asset.name) || null,
      isInstaller: !!(asset && /setup/i.test(asset.name)),
      notes: String(release.body || '').slice(0, 4000),
      publishedAt: release.published_at
    };
  } catch (e) {
    return { currentVersion, error: (e && e.message) || 'network error' };
  }
});

// LOCAL PATCH: in-app updater -------------------------------------------------
// Two kinds of build ship from this repo and they update differently:
//
//  - Portable exe: electron-builder's `portable` target runs the app from a temp
//    folder, so `process.execPath` is useless. It hands us the file the user
//    actually double-clicked via PORTABLE_EXECUTABLE_FILE: download the new
//    portable exe, wait for this process to exit, copy it over that file.
//  - Installed build (NSIS Setup): `process.execPath` is the real installed exe,
//    so updating means running the new Setup silently and relaunching.
function updateMode() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable) return { mode: 'portable', target: portable };
  if (app.isPackaged) return { mode: 'installed', target: process.execPath };
  return { mode: 'none', target: null };
}

ipcMain.handle('update-capability', () => {
  const { mode, target } = updateMode();
  return {
    canSelfUpdate: mode !== 'none',
    mode,
    target: mode === 'none' ? null : target,
    version: app.getVersion()
  };
});

ipcMain.handle('download-update', async (event, opts = {}) => {
  const url = opts.url;
  if (!url) return { ok: false, error: 'No download URL for this release.' };

  const version = String(opts.version || 'new').replace(/[^\w.-]/g, '');
  const expected = String(opts.digest || '').replace(/^sha256:/i, '').trim().toLowerCase();
  const tempDir = app.getPath('temp');

  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('update-progress', payload);
  };

  const logLine = (line) => {
    try { fs.appendFileSync(path.join(tempDir, 'dfr-download.log'), line + '\n'); } catch (e) {}
  };

  // One download into its own freshly created file. Throws on any problem.
  const attempt = async (dest) => {
    // Never write into a file that is already there: a leftover (or locked) file
    // from a previous run is exactly how a download can end up with the right
    // size but the wrong bytes.
    try { fs.unlinkSync(dest); } catch (e) {}

    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Twitch-Drops-Farmer-Revived' }
    });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);

    const total = Number(res.headers.get('content-length')) || 0;

    // Count the bytes on the way through, then hash the finished file from disk.
    // pipeline() only resolves once the destination has been closed, so the file
    // we hash is the complete file - a plain 'finish' handler can fire while the
    // last writes are still in flight, which is how a download can hash correctly
    // in memory but differ on disk (seen on a real 1.3.3 update).
    let received = 0;
    let lastTick = 0;
    const counter = new Transform({
      transform(chunk, enc, cb) {
        received += chunk.length;
        const now = Date.now();
        if (now - lastTick > 200) {
          lastTick = now;
          send({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0 });
        }
        cb(null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));

    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    // The file on disk is what gets installed, so that is what gets hashed.
    let diskHash = '';
    try { diskHash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'); } catch (e) {}
    logLine(`[${new Date().toISOString()}] ${path.basename(dest)} expected=${expected || '-'} disk=${diskHash} size=${size} total=${total}`);

    // A truncated or corrupted download must never be installed over a working exe.
    if (total && size !== total) throw new Error(`The download stopped early (${size} of ${total} bytes).`);
    if (size < 10 * 1024 * 1024) throw new Error('The downloaded file looks incomplete.');

    // A Windows exe always starts with "MZ".
    let head = '';
    try {
      const fd = fs.openSync(dest, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      head = buf.toString('latin1');
    } catch (e) { /* the size checks above already passed */ }
    if (head && head !== 'MZ') throw new Error('The downloaded file is not a Windows program.');

    if (expected && diskHash !== expected) {
      console.error(`[Updates] checksum mismatch: expected ${expected}, disk ${diskHash}`);
      throw new Error('checksum mismatch');
    }

    return { dest, size };
  };

  // Two tries, the second on a brand new path: if the first file was written
  // wrong (stale/locked file, interrupted write) the retry usually lands.
  let lastError = '';
  for (let i = 1; i <= 2; i++) {
    const dest = path.join(tempDir, `DropsFarmerRevived_v${version}${i > 1 ? `-retry${i}` : ''}.exe`);
    try {
      const out = await attempt(dest);
      send({ received: out.size, total: out.size, percent: 100 });
      return { ok: true, path: out.dest, size: out.size };
    } catch (e) {
      lastError = (e && e.message) || 'Download failed.';
      console.error(`[Updates] download attempt ${i} failed: ${lastError}`);
      try { fs.unlinkSync(dest); } catch (e2) {}
    }
  }

  return {
    ok: false,
    error: lastError === 'checksum mismatch'
      ? 'The download was corrupted on the way in. Try again.'
      : lastError
  };
});

ipcMain.handle('install-update', async (event, opts = {}) => {
  const { mode, target } = updateMode();
  const file = opts.path;

  if (mode === 'none') return { ok: false, error: 'This build cannot update itself - use the release page.' };
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'The update file is missing, download it again.' };

  const logFile = path.join(app.getPath('temp'), 'dfr-update.log');
  // hex sha256 of the new exe, if GitHub gave us one for this release
  const expected = String(opts.digest || '').replace(/^sha256:/i, '').trim().toLowerCase();

  const logLine = (line) => {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`); } catch (e) {}
  };
  const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Check the payload again right before it is used: the download was verified,
  // but this is the file that replaces something that works.
  let payloadHash = '';
  try {
    payloadHash = sha256File(file);
  } catch (e) {
    return { ok: false, error: 'The update file could not be read. Download it again.' };
  }
  if (expected && payloadHash !== expected) {
    logLine(`UPDATE_VERIFY_FAILED expected=${expected} got=${payloadHash}`);
    try { fs.unlinkSync(file); } catch (e) {}
    return { ok: false, error: 'The update file failed its checksum. Download it again.' };
  }

  // No PowerShell, no cmd, no .bat and no console window anywhere in here.
  //
  // Portable build: the portable launcher is a separate process, so the file the
  // user double-clicked can be swapped from inside the app. Windows allows
  // renaming a file that is in use (it does not allow deleting it), which is all
  // we need: stage the verified new exe next to it, move the old one aside, move
  // the new one into place, start it, quit.
  if (mode === 'portable') {
    const staged = target + '.new';
    const backup = target + '.old';

    // 1. stage + verify next to the target (same volume, so the moves are atomic)
    try { fs.unlinkSync(staged); } catch (e) {}
    let stagedOk = false;
    for (let i = 0; i < 20 && !stagedOk; i++) {
      try {
        fs.copyFileSync(file, staged);
        stagedOk = true;
      } catch (e) {
        await sleep(250);
      }
    }
    if (!stagedOk) {
      logLine('SWAP_FAILED - could not stage the new exe');
      return { ok: false, error: 'Windows would not let the update write the new build. Run the downloaded file instead.' };
    }
    let stagedHash = '';
    try { stagedHash = sha256File(staged); } catch (e) {}
    if (expected && stagedHash !== expected) {
      logLine(`COPY_VERIFY_FAILED expected=${expected} got=${stagedHash}`);
      try { fs.unlinkSync(staged); } catch (e) {}
      return { ok: false, error: 'The update did not copy correctly. The app was not changed.' };
    }
    logLine(`COPY_VERIFIED ${stagedHash}`);

    // 2. move the old exe aside (allowed even while the launcher is using it)
    try { fs.unlinkSync(backup); } catch (e) {}
    let renamed = false;
    for (let i = 0; i < 40 && !renamed; i++) {
      try {
        fs.renameSync(target, backup);
        renamed = true;
      } catch (e) {
        await sleep(250);
      }
    }
    if (!renamed) {
      try { fs.unlinkSync(staged); } catch (e) {}
      logLine('SWAP_FAILED - could not move the old exe aside');
      return { ok: false, error: 'Windows is still holding the app file. Close the app, then run the downloaded file.' };
    }

    // 3. put the verified file in place; restore the old one if this fails
    let installed = false;
    for (let i = 0; i < 20 && !installed; i++) {
      try {
        fs.renameSync(staged, target);
        installed = true;
      } catch (e) {
        await sleep(250);
      }
    }
    if (!installed) {
      try { fs.renameSync(backup, target); } catch (e) {}
      try { fs.unlinkSync(staged); } catch (e) {}
      logLine('SWAP_FAILED - could not put the new exe in place');
      return { ok: false, error: 'Windows would not let the update replace the app. Close the app, then run the downloaded file.' };
    }

    const landed = sha256File(target);
    if (expected && landed !== expected) {
      try { fs.unlinkSync(target); } catch (e) {}
      try { fs.renameSync(backup, target); } catch (e) {}
      logLine(`SWAP_VERIFY_FAILED expected=${expected} got=${landed}`);
      return { ok: false, error: 'The update did not install correctly. The app was not changed.' };
    }

    logLine(`SWAP_VERIFIED ${landed}`);
    logLine(`COPY_OK ${landed}`);
    try { fs.unlinkSync(file); } catch (e) {}
    // the old file is deleted on the next launch (this launcher still has it open).
    // app.relaunch starts the new copy only after this process has exited, so the
    // new instance cannot lose the single-instance lock to the one that is quitting.
    app.relaunch({ execPath: target, args: process.argv.slice(1) });
    logLine('relaunched');

    setTimeout(() => {
      isQuitting = true;
      app.exit(0);
    }, 300);
    return { ok: true, target, mode };
  }

  // Installed build: the Setup is the update. Start it detached and quit; the
  // installer's own NSIS script closes every process with the app's exe name,
  // replaces the files, and (because of --force-run) starts the new build when
  // it is done. No helper process and no shell: the only two programs involved
  // are this app and the verified Setup.
  //
  // The old helper ran from the installed exe to wait for the app to exit, but
  // that kept the exe open and made the installer fail with "Failed to uninstall
  // old application files" (exit code 2). The installer can wait for the app by
  // itself, so it does.
  //
  // /S is a silent install; --force-run makes NSIS start the app after a silent
  // install. The env hook lets the path be tested against a temp install
  // directory instead of the real one.
  const installArgs = ['/S', '--force-run'];
  if (process.env.DFR_UPDATE_ARGS) installArgs.push(process.env.DFR_UPDATE_ARGS);

  try {
    const child = spawn(file, installArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    logLine(`INSTALLER_STARTED pid=${child.pid} args=${installArgs.join(' ')}`);

    // Give the installer a moment to create its process before this one exits.
    setTimeout(() => {
      isQuitting = true;
      app.exit(0);
    }, 500);

    return { ok: true, target, mode };
  } catch (e) {
    logLine('INSTALLER_FAILED ' + ((e && e.message) || 'spawn failed'));
    return { ok: false, error: 'Could not start the installer. Run the downloaded file instead.' };
  }
});

ipcMain.handle('get-user-info', async (event, tokens) => {
  return await gql.execute('GetUserInfo', {}, buildHeaders(tokens));
});

ipcMain.handle('fetch-campaigns', async (event, tokens) => {
  const headers = buildHeaders(tokens);
  console.log('CAMPAIGN_REQ:', {
    hasAuth: !!headers.Authorization,
    hasIntegrity: !!headers['Client-Integrity'],
    integrityLen: (headers['Client-Integrity'] || '').length,
    hasDeviceId: !!headers['Device-Id']
  });

  const data = await gql.execute('ViewerDropsDashboard', {}, headers);

  if (data.error === 'HASH_EXPIRED') {
    // Fallback: use raw query if hash expired
    console.log('[GQL] Hash expired for ViewerDropsDashboard, using raw query fallback...');
    return await _fetchCampaignsFallback(headers);
  }

  try { require('fs').writeFileSync(path.join(__dirname, 'debug_campaigns.json'), JSON.stringify(data, null, 2)); } catch (e) { }
  return data;
});

// Fallback with raw query (in case persisted hash expires)
async function _fetchCampaignsFallback(headers) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        operationName: 'ViewerDropsDashboard',
        variables: {},
        query: `query ViewerDropsDashboard { currentUser { dropCurrentSession { dropID game { id displayName } currentMinutesWatched requiredMinutesWatched } dropCampaigns { id status detailsURL allow { channels { name } isEnabled } game { id displayName viewersCount boxArtURL } name startAt endAt timeBasedDrops { id requiredMinutesWatched requiredSubs name startAt endAt benefitEdges { benefit { id name imageAssetURL distributionType } } self { dropInstanceID currentMinutesWatched isClaimed hasPreconditionsMet } } } } }`
      })
    });
    clearTimeout(timer);

    if (res.status === 401) {
      console.error(`[GQL] _fetchCampaignsFallback: HTTP 401 Unauthorized`);
      return { error: 'AUTH_EXPIRED' };
    }

    const data = await res.json();
    if (data.errors?.some(e => {
      const msg = (e.message || '').toLowerCase();
      return msg.includes('unauthorized') || msg.includes('authorization') || msg.includes('oauth') || msg.includes('token') || msg.includes('session');
    })) {
      console.error(`[GQL] _fetchCampaignsFallback: Authentication expired or invalid`);
      return { error: 'AUTH_EXPIRED', details: data.errors };
    }

    return data;
  } catch (e) {
    return { error: e.message };
  }
}

ipcMain.handle('fetch-campaign-details', async (event, campaignId, tokens) => {
  const userLogin = tokens.userLogin || 'twitch';
  return await gql.execute('DropCampaignDetails', {
    channelLogin: userLogin,
    campaignID: campaignId
  }, buildHeaders(tokens));
});

ipcMain.handle('claim-drop', async (event, dropInstanceId, tokens) => {
  return await gql.execute('ClaimDrop', {
    input: { dropInstanceID: dropInstanceId }
  }, buildHeaders(tokens));
});

// LOCAL PATCH: game directory search ------------------------------------------
// The priority list used to know only about games that currently have a drop
// campaign, so a game without drops had no box art and could not be found by
// searching. Twitch's public web GraphQL lets us search the whole game
// directory anonymously (no login), which the renderer uses for the search
// results and for the icon of any game already in the priority list.
const GAME_SEARCH_TTL_MS = 10 * 60 * 1000;
const gameSearchCache = new Map(); // lowercased query -> { at, games }

ipcMain.handle('search-games', async (event, query) => {
  const q = String(query || '').trim();
  if (q.length < 2) return { games: [] };

  const key = q.toLowerCase();
  const cached = gameSearchCache.get(key);
  if (cached && Date.now() - cached.at < GAME_SEARCH_TTL_MS) return { games: cached.games };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'User-Agent': 'Twitch-Drops-Farmer-Revived'
      },
      body: JSON.stringify({
        operationName: 'SearchCategories',
        variables: { query: q, first: 12 },
        query: `query SearchCategories($query: String!, $first: Int) { searchCategories(query: $query, first: $first) { edges { node { id name displayName boxArtURL } } } }`
      })
    });

    if (!res.ok) return { games: [], error: `Game search failed (HTTP ${res.status}).` };

    const data = await res.json();
    const edges = (data && data.data && data.data.searchCategories && data.data.searchCategories.edges) || [];
    const games = edges
      .map((edge) => edge && edge.node)
      .filter((node) => node && node.id && node.displayName)
      .map((node) => ({
        id: String(node.id),
        name: node.name || '',
        displayName: node.displayName,
        boxArtURL: node.boxArtURL || ''
      }));

    gameSearchCache.set(key, { at: Date.now(), games });
    if (gameSearchCache.size > 200) {
      gameSearchCache.delete(gameSearchCache.keys().next().value); // oldest entry
    }
    return { games };
  } catch (e) {
    return { games: [], error: (e && e.message) || 'Game search failed.' };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('find-streamer', async (event, gameName, tokens, whitelistedLogins = null) => {
  try {
    const headers = buildHeaders(tokens);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    if (whitelistedLogins && Array.isArray(whitelistedLogins) && whitelistedLogins.length > 0) {
      console.log(`[GQL] Checking live status for whitelisted channels: ${whitelistedLogins.join(', ')}`);
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          query: `query($logins: [String!]) {
            users(logins: $logins) {
              id
              login
              stream {
                title
                freeformTags { name }
              }
            }
          }`,
          variables: { logins: whitelistedLogins }
        })
      });
      clearTimeout(timer);
      const data = await res.json();
      const users = data?.data?.users || [];
      const edges = users
        .filter(u => u && u.stream)
        .map(u => ({
          node: {
            title: u.stream.title || '',
            broadcaster: {
              id: u.id,
              login: u.login
            },
            freeformTags: u.stream.freeformTags || []
          }
        }));
      return { data: { game: { streams: { edges } } } };
    }

    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        query: `query($gameName: String!) { 
          game(name: $gameName) { 
            streams(first: 50) { 
              edges { 
                node { 
                  title
                  broadcaster { id login } 
                  freeformTags { name }
                } 
              } 
            } 
          } 
        }`,
        variables: { gameName }
      })
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('check-channel-drops', async (event, channelId, tokens) => {
  try {
    const headers = buildHeaders(tokens);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        operationName: 'DropChannelCampaignsProgress',
        variables: { channelID: channelId.toString() },
        query: `query DropChannelCampaignsProgress($channelID: ID!) {
          channelDropCampaignsProgress(channelID: $channelID) {
            id
            name
            game {
              id
              name
            }
          }
        }`
      })
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('get-drop-session', async (event, channelId, tokens, channelLogin = "") => {
  return await gql.execute('DropCurrentSessionContext', {
    channelLogin,
    channelID: channelId.toString()
  }, buildHeaders(tokens), { arrayWrap: true });
});

ipcMain.handle('get-inventory', async (event, tokens) => {
  const now = Date.now();
  if (inventoryCache.data && (now - inventoryCache.timestamp) < inventoryCache.ttl) {
    return inventoryCache.data;
  }

  const data = await gql.execute('Inventory', {}, buildHeaders(tokens));

  if (data.error === 'HASH_EXPIRED') {
    // Fallback with raw query
    return await _fetchInventoryFallback(buildHeaders(tokens));
  }

  if (!data.error) {
    inventoryCache = { data, timestamp: now, ttl: 20000 };
  }
  return data;
});

async function _fetchInventoryFallback(headers) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        variables: {},
        query: `query Inventory { currentUser { inventory { dropCampaignsInProgress { id status detailsURL allow { channels { name } isEnabled } game { id displayName viewersCount boxArtURL } name startAt endAt timeBasedDrops { id requiredMinutesWatched requiredSubs name startAt endAt benefitEdges { benefit { id name imageAssetURL distributionType } } self { dropInstanceID currentMinutesWatched isClaimed hasPreconditionsMet } } } gameEventDrops { id name lastAwardedAt } } } }`
      })
    });
    clearTimeout(timer);

    if (res.status === 401) {
      console.error(`[GQL] _fetchInventoryFallback: HTTP 401 Unauthorized`);
      return { error: 'AUTH_EXPIRED' };
    }

    const data = await res.json();
    if (data.errors?.some(e => {
      const msg = (e.message || '').toLowerCase();
      return msg.includes('unauthorized') || msg.includes('authorization') || msg.includes('oauth') || msg.includes('token') || msg.includes('session');
    })) {
      console.error(`[GQL] _fetchInventoryFallback: Authentication expired or invalid`);
      return { error: 'AUTH_EXPIRED', details: data.errors };
    }

    inventoryCache = { data, timestamp: Date.now(), ttl: 20000 };
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * WebSocket communication handlers for real-time progress updates
 */

ipcMain.handle('ws-connect', async (event, userId, authToken) => {
  try {
    const status = wsManager.getStatus();
    if (status.connected && status.userId === userId && status.subscribed) {
      console.log(`[WS] Already connected and subscribed for userId ${userId}. Skipping redundant connect.`);
      return { success: true, alreadyConnected: true };
    }

    wsManager.removeAllListeners();

    wsManager.on('drop-progress', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-drop-progress', data);
      }
    });
    wsManager.on('drop-claim', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-drop-claim', data);
      }
    });
    wsManager.on('drop-event', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-drop-event', data);
      }
    });
    wsManager.on('disconnected', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-disconnected', data);
      }
    });

    wsManager.connect(userId, authToken);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('ws-status', async () => wsManager.getStatus());
ipcMain.handle('ws-disconnect', async () => { wsManager.disconnect(); return { success: true }; });
ipcMain.handle('get-app-version', () => app.getVersion());

// Discord RPC IPC handlers
ipcMain.on('rpc-toggle', (event, enabled) => {
  console.log('[Main IPC] rpc-toggle received:', enabled);
  if (enabled) {
    rpc.start();
  } else {
    rpc.stop();
  }
});

ipcMain.on('rpc-update', (event, activity) => {
  rpc.setActivity(activity);
});

ipcMain.on('rpc-set-client-id', (event, clientId) => {
  console.log('[Main IPC] rpc-set-client-id received:', clientId);
  if (rpc.clientId !== clientId) {
    rpc.clientId = clientId;
    if (rpc.enabled) {
      console.log('[Main IPC] Client ID updated while RPC enabled. Restarting...');
      rpc.stop();
      rpc.start();
    }
  }
});

// ============================================================
// Farm Window
// ============================================================

let farmWin = null;
ipcMain.on('start-farm', (event, username) => {
  if (farmWin) farmWin.destroy();
  if (!username) return;

  farmWin = new BrowserWindow({
    width: 800, height: 600,
    show: false,
    webPreferences: {
      backgroundThrottling: false
    }
  });

  farmWin.webContents.setAudioMuted(true);
  // Disabled setFrameRate(5) for better compatibility

  farmWin.loadURL(`https://www.twitch.tv/${username}`);

  farmWin.webContents.on('did-finish-load', () => {
        farmWin.webContents.executeJavaScript(`
       (function() {
         const style = document.createElement('style');
         style.innerHTML = \`
           .side-nav, .top-nav, .right-column, .chat-shell, 
           .channel-root__right-column, .video-chat { 
              display: none !important; 
           } 
           .video-player__container { 
               width: 10px !important; 
               height: 10px !important; 
               opacity: 0.01 !important; 
               pointer-events: none !important;
           }
         \`;
         document.head.appendChild(style);
         
         const removeList = ['.side-nav', '.chat-shell', '.top-nav'];
         removeList.forEach(sel => {
           const el = document.querySelector(sel);
           if (el) el.remove();
         });

         setInterval(() => {
             const stayActive = document.querySelector('button[aria-label="Yes, I am still watching"], .tw-button--success');
             if (stayActive) stayActive.click();
             const video = document.querySelector('video');
             if (video && video.paused) video.play().catch(() => {});
         }, 30000);

         // Force lowest quality immediately by polling
         let qualityAttempts = 0;
         let qInterval = setInterval(() => {
            qualityAttempts++;
            if (qualityAttempts > 60) clearInterval(qInterval); // Stop trying after 30s
            
            const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]');
            if (settingsBtn) {
                settingsBtn.click();
                setTimeout(() => {
                    const qualityMenu = document.querySelector('[data-a-target="player-settings-menu-item-quality"]');
                    if (qualityMenu) {
                        qualityMenu.click();
                        setTimeout(() => {
                            const qualities = Array.from(document.querySelectorAll('input[name="player-settings-submenu-quality-option"]'));
                            const lowest = qualities[qualities.length - 1]; // 160p is usually last
                            if (lowest) {
                                lowest.parentElement.click();
                                clearInterval(qInterval); // Success, stop polling
                            }
                            setTimeout(() => settingsBtn.click(), 100); // Close menu
                        }, 300);
                    } else {
                        settingsBtn.click(); // Close if no quality menu found
                    }
                }, 300);
            }
         }, 500); 
       })();
    `).catch(e => { });
    console.log('[Farm] Window active for: ' + username);
  });
});

ipcMain.on('stop-farm', () => {
  if (farmWin) { farmWin.destroy(); farmWin = null; }
});

let claimWin = null;
let isProcessingClaim = false;

ipcMain.on('claim-via-window', () => {
  if (claimWin || isProcessingClaim) return;
  isProcessingClaim = true;

  console.log("[ClaimBot] Opening hidden claim window...");
  claimWin = new BrowserWindow({
    width: 1000, height: 800,
    show: false, // Keep it hidden
    webPreferences: { backgroundThrottling: false }
  });

  // Mute it just in case
  claimWin.webContents.setAudioMuted(true);

  claimWin.loadURL('https://www.twitch.tv/drops/inventory');

  claimWin.webContents.on('did-finish-load', async () => {
    // Wait longer for Twitch's inventory to load (initial fetch + react render)
    if (mainWindow) mainWindow.webContents.send('log-msg', { msg: `[Window-Claim] Inventory page loaded. Waiting 10s for items to appear...`, type: 'info' });
    await new Promise(r => setTimeout(r, 10000));

    try {
      const results = await claimWin.webContents.executeJavaScript(`
                (() => {
                    const findAndClick = () => {
                        let clickedDetails = [];
                        const seen = new Set();

                        document.querySelectorAll('button').forEach(btn => {
                            if (seen.has(btn)) return;

                            const html = btn.outerHTML.toLowerCase();
                            const text = (btn.innerText || "").toLowerCase().trim();
                            
                             const isClaimText = [
                                 'claim', 'claim now', 'claim reward', 'claim drop',
                                 'получить', 'получить сейчас', 'получить награду', 'забрать', 'забрать сейчас',
                                 'abholen', 'jetzt abholen',
                                 'reclamar', 'reclamar ahora',
                                 'resgatar', 'resgatar agora',
                                 'récupérer', 'obtenir',
                                 'odbierz', 'odbierz teraz',
                                 'riscatta', 'al', '받기', '受け取る', '领取'
                             ].some(word => {
                                 if (word === 'al') return text === 'al';
                                 return text.includes(word);
                             });
                            
                            const isClaimAttr = html.includes('claim-button') || 
                                                html.includes('claim_drop') || 
                                                html.includes('claim-reward') ||
                                                html.includes('claimbutton');
                            
                            const style = window.getComputedStyle(btn);
                            const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
                            
                            if ((isClaimText || isClaimAttr) && !btn.disabled && isVisible) {
                                btn.click();
                                clickedDetails.push({ text: btn.innerText.trim(), htmlSnippet: html.substring(0, 100) });
                                seen.add(btn);
                            }
                        });
                        return clickedDetails;
                    };
                    return findAndClick();
                })();
            `);

      console.log(`[ClaimBot] Script executed. Clicked buttons:`, JSON.stringify(results));
      if (mainWindow) {
        const btnTexts = results.map(r => r.text || 'Claim').join(', ');
        mainWindow.webContents.send('log-msg', { 
          msg: `[Window-Claim] Search complete. Clicked buttons: ${results.length} (${btnTexts || 'none'})`, 
          type: results.length > 0 ? 'farm' : 'info' 
        });
      }
    } catch (e) {
      console.error("[ClaimBot] Script failed:", e);
      if (mainWindow) mainWindow.webContents.send('log-msg', { msg: `[Window-Claim] ${e.message}`, type: 'warn' });
    } finally {
      // Close after work (giving 15 seconds for Twitch requests to complete)
      setTimeout(() => {
        if (claimWin && !claimWin.isDestroyed()) {
          claimWin.destroy();
          claimWin = null;
        }
        isProcessingClaim = false;
        // Notify renderer to refresh inventory after window work
        if (mainWindow) mainWindow.webContents.send('log-msg', { msg: `[Window-Claim] Process finished. Refreshing inventory...`, type: 'system', refresh: true });
      }, 15000);
    }
  });
});

let refreshWin = null;
let isRefreshingToken = false;
let integrityRefreshTimer = null;
let tokenCapturedDuringRefresh = false;

ipcMain.on('refresh-integrity-token', () => {
  if (refreshWin || isRefreshingToken) return;
  isRefreshingToken = true;
  tokenCapturedDuringRefresh = false;

  console.log("[IntegrityBot] Opening silent window to refresh integrity token...");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-msg', { msg: `[IntegrityBot] Refreshing security token in background...`, type: 'info' });
  }

  refreshWin = new BrowserWindow({
    width: 600, height: 800,
    show: false, // Keep it hidden
    webPreferences: { backgroundThrottling: false }
  });

  refreshWin.webContents.setAudioMuted(true);
  refreshWin.loadURL('https://www.twitch.tv/drops/inventory');

  if (integrityRefreshTimer) clearTimeout(integrityRefreshTimer);

  integrityRefreshTimer = setTimeout(() => {
    if (refreshWin && !refreshWin.isDestroyed()) {
      refreshWin.destroy();
      refreshWin = null;
    }
    const captured = tokenCapturedDuringRefresh;
    isRefreshingToken = false;
    console.log(`[IntegrityBot] Silent window closed. Token captured: ${captured}`);

    if (!captured && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('integrity-refresh-failed', { reason: 'TIMEOUT' });
    }
  }, 12000); // Wait up to 12 seconds for GQL traffic to trigger token capture
});

// ============================================================
// LOCAL PATCH: silent auto-connect - no Twitch window, no browser tab
// This app's own Chromium profile keeps the Twitch web session in
// %APPDATA%\twitch-drop-farmer. At start-up the stored auth-token cookie is
// read from that profile and handed to the renderer exactly as if it had
// been captured from live traffic, so the app connects to your account by
// itself. Nothing is opened: no browser tab, no Twitch window, no device
// code. That stored profile session is also what makes the hidden farm
// window count watch minutes, since it only earns progress for a signed-in
// viewer. If the session is ever gone the normal "Login" button still works
// (device-code login, code copied to the clipboard automatically).
// ============================================================
let lastCaptureAt = 0;   // module scope: also set by the gql interceptor above
let autoAuthWin = null;

async function trySilentAutoConnect() {
  try {
    if (lastCaptureAt) return true;

    const authCookies = await session.defaultSession.cookies.get({ name: 'auth-token' });
    const authCookie = (authCookies || []).find((c) => /twitch\.tv$/.test(c.domain));
    if (!authCookie || !authCookie.value) {
      console.log('[AutoConnect] no auth-token cookie stored in this profile');
      return false;
    }

    const idCookies = await session.defaultSession.cookies.get({ name: 'unique_id' });
    const deviceId = (idCookies && idCookies.length) ? idCookies[0].value : '';

    const headers = {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Authorization': 'OAuth ' + authCookie.value,
      'Content-Type': 'application/json'
    };
    if (deviceId) headers['X-Device-Id'] = deviceId;

    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: '{ currentUser { id login } }' })
    });
    const payload = await res.json();
    const user = payload && payload.data && payload.data.currentUser;
    if (!user) {
      console.log('[AutoConnect] stored session was rejected:', JSON.stringify(payload).slice(0, 200));
      return false;
    }

    lastCaptureAt = Date.now();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth-token-captured', {
        auth: headers['Authorization'],
        integrity: '',
        clientId: headers['Client-Id'],
        deviceId
      });
    }
    console.log('[AutoConnect] Connected as', user.login);
    return true;
  } catch (e) {
    console.error('[AutoConnect] failed:', e && e.message);
    return false;
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  setTimeout(() => {
    trySilentAutoConnect().then((ok) => {
      if (!ok) console.log('[AutoConnect] no stored Twitch session found - use the Login button when you are ready.');
    });
  }, 2500);
});

// Opt-in only, and never triggered automatically: pass --twitch-login to get a
// one-time Twitch sign-in window, in case the profile ever loses its session.
if (process.argv.includes('--twitch-login')) {
  app.whenReady().then(() => {
    autoAuthWin = new BrowserWindow({
      width: 1000,
      height: 820,
      autoHideMenuBar: true,
      title: `Log in to Twitch (${BRAND_NAME} session)`
    });
    autoAuthWin.loadURL('https://www.twitch.tv/login');
    autoAuthWin.webContents.setAudioMuted(true);
  });
}
