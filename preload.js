const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  onTokenCaptured: (callback) => ipcRenderer.on('auth-token-captured', (_event, value) => {
    if (value && value.auth) callback(value)
  }),
  onIntegrityRefreshFailed: (callback) => ipcRenderer.on('integrity-refresh-failed', (_event, value) => callback(value)),
  requestDeviceCode: () => ipcRenderer.invoke('request-device-code'),
  pollDeviceToken: (deviceCode) => ipcRenderer.invoke('poll-device-token', deviceCode),

  // GQL Queries
  getCampaigns: (tokens) => ipcRenderer.invoke('fetch-campaigns', tokens),
  fetchCampaignDetails: (campaignId, tokens) => ipcRenderer.invoke('fetch-campaign-details', campaignId, tokens),
  findStreamer: (gameName, tokens, whitelistedLogins = null) => ipcRenderer.invoke('find-streamer', gameName, tokens, whitelistedLogins),
  checkChannelDrops: (channelId, tokens) => ipcRenderer.invoke('check-channel-drops', channelId, tokens),
  getDropSession: (channelId, tokens, channelLogin) => ipcRenderer.invoke('get-drop-session', channelId, tokens, channelLogin),
  getInventory: (tokens) => ipcRenderer.invoke('get-inventory', tokens),
  getUserInfo: (tokens) => ipcRenderer.invoke('get-user-info', tokens),
  claimDrop: (dropInstanceId, tokens) => ipcRenderer.invoke('claim-drop', dropInstanceId, tokens),

  // Farm control
  startFarm: (username) => ipcRenderer.send('start-farm', username),
  stopFarm: () => ipcRenderer.send('stop-farm'),
  claimViaWindow: () => ipcRenderer.send('claim-via-window'),
  refreshIntegrityToken: () => ipcRenderer.send('refresh-integrity-token'),
  updateTrayTooltip: (text) => ipcRenderer.send('update-tray-tooltip', text),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),

  // Local patch: window controls (the native title bar is hidden)
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window-maximize-toggle'),
  hideWindowToTray: () => ipcRenderer.send('window-close'),
  quitApp: () => ipcRenderer.send('window-quit'),

  // WebSocket
  wsConnect: (userId, authToken) => ipcRenderer.invoke('ws-connect', userId, authToken),
  wsStatus: () => ipcRenderer.invoke('ws-status'),
  wsDisconnect: () => ipcRenderer.invoke('ws-disconnect'),
  onWsDropProgress: (callback) => ipcRenderer.on('ws-drop-progress', (_event, data) => callback(data)),
  onWsDropClaim: (callback) => ipcRenderer.on('ws-drop-claim', (_event, data) => callback(data)),
  onWsDropEvent: (callback) => ipcRenderer.on('ws-drop-event', (_event, data) => callback(data)),
  onWsDisconnected: (callback) => ipcRenderer.on('ws-disconnected', (_event, data) => callback(data)),
  onLogMsg: (callback) => ipcRenderer.on('log-msg', (_event, data) => callback(data)),
  
  // Discord RPC
  rpcToggle: (enabled) => ipcRenderer.send('rpc-toggle', enabled),
  rpcUpdate: (activity) => ipcRenderer.send('rpc-update', activity),
  rpcSetClientId: (clientId) => ipcRenderer.send('rpc-set-client-id', clientId),
  
  // App utilities
  openExternal: (url) => ipcRenderer.send('open-external', url),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Local patch: in-app updater (portable build swaps its own exe)
  updateCapability: () => ipcRenderer.invoke('update-capability'),
  downloadUpdate: (opts) => ipcRenderer.invoke('download-update', opts),
  installUpdate: (opts) => ipcRenderer.invoke('install-update', opts),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_event, data) => callback(data)),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (opts) => ipcRenderer.invoke('set-auto-launch', opts)
})
