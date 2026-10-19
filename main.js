const { app, BrowserWindow, session, ipcMain, Tray, Menu, nativeImage, shell, clipboard } = require('electron')
const path = require('node:path')
const fs = require('fs')

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

// Same behaviour as the X button always had: hide to the tray, keep farming.
ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  // Windows: tell the user where the app went, once per run.
  if (process.platform === 'win32' && tray && !trayBalloonShown) {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({
        title: `${BRAND_NAME} is still running`,
        content: 'Minimized to the tray - farming continues. Click the tray icon to reopen, or right-click it to quit.'
      });
    } catch (e) { /* balloons are best-effort */ }
  }
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
    return {
      autoLaunchEnabled: typeof config.autoLaunchEnabled === 'boolean' ? config.autoLaunchEnabled : settings.openAtLogin,
      autoLaunchHidden: typeof config.autoLaunchHidden === 'boolean' ? config.autoLaunchHidden : settings.openAsHidden,
      autoStartFarm: typeof config.autoStartFarm === 'boolean' ? config.autoStartFarm : false,
      autoStartFarmMode: config.autoStartFarmMode || 'priority'
    };
  } catch (e) {
    return { autoLaunchEnabled: false, autoLaunchHidden: false, autoStartFarm: false, autoStartFarmMode: 'priority' };
  }
});

ipcMain.handle('set-auto-launch', (event, cfg) => {
  try {
    saveConfig({
      autoLaunchEnabled: !!cfg.autoLaunchEnabled,
      autoLaunchHidden: !!cfg.autoLaunchHidden,
      autoStartFarm: !!cfg.autoStartFarm,
      autoStartFarmMode: cfg.autoStartFarmMode || 'priority'
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
      nodeIntegration: false
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

  // LOCAL PATCH: the old code intercepted 'minimize' and hid the window to the
  // tray instead, which made clicking the taskbar icon look like the app had
  // closed into the background. Minimising now behaves like any other window:
  // the app stays in the taskbar and clicking its icon brings it back. Use the
  // header's X button (or Settings > Minimize to tray) to hide it to the tray.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
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
    const asset = (release.assets || []).find((a) => /\.exe$/i.test(a.name));

    return {
      currentVersion,
      latestVersion,
      hasUpdate: semverNewer(latestVersion, currentVersion),
      releaseUrl: release.html_url,
      downloadUrl: asset ? asset.browser_download_url : release.html_url,
      notes: String(release.body || '').slice(0, 4000),
      publishedAt: release.published_at
    };
  } catch (e) {
    return { currentVersion, error: (e && e.message) || 'network error' };
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
