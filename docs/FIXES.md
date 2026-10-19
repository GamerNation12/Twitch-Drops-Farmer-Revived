# What was changed (v1.3.0 → v1.3.1)

Every change below is relative to upstream
`lokalizator-repo/TwitchDropsFarmer@v1.3.0`. Files touched: `main.js`,
`preload.js`, `renderer.js`, `package.json`.

---

## 1. Locale files (the "black window" crash)

Upstream `package.json` limited the Electron locales:

```json
"electronLanguages": ["en", "ru"],
```

The published `TwitchDropsFarmer_v1.3.0.exe` ended up containing **only**
`locales\ru.pak`. Chromium asks for `en-US.pak` first on an English system; when the
file is missing the renderer process dies on startup with `0xC0000005`
(`-1073741819`). The main process survives, so you get a window that painted nothing
but its background colour — the famous black window.

Fix: the `electronLanguages` restriction is removed, so `electron-builder` ships the
full locale set and `en-US.pak` is always present. (Running from source with
`npm start` uses the Electron installation's own locales, so nothing else is needed.)

## 2. Device-code login

Twitch no longer accepts the app's client id (`kimne78kx3ncx6brgo4mv6wki5h1ko`) for
`POST https://id.twitch.tv/oauth2/device`:

```
$ curl -s -X POST https://id.twitch.tv/oauth2/device -d "client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&scopes="
{"status":400,"message":"invalid client"}
```

The TV client id still works, and that is what this build uses:

```
$ curl -s -X POST https://id.twitch.tv/oauth2/device -d "client_id=ue6666qo983tsx6so1t0vnawi233wa&scopes=user:read:email"
{"device_code":"...","user_code":"...","verification_uri":"https://www.twitch.tv/activate", ...}
```

`main.js` — three places, so the token and the requests that carry it agree:

```diff
-    'Client-Id': tokens.clientId || 'kimne78kx3ncx6brgo4mv6wki5h1ko',
+    'Client-Id': tokens.clientId || 'ue6666qo983tsx6so1t0vnawi233wa',
```

```diff
-      body: 'client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&scopes='
+      body: 'client_id=ue6666qo983tsx6so1t0vnawi233wa&scopes=user:read:email'
```

```diff
-      body: `client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&device_code=...`
+      body: `client_id=ue6666qo983tsx6so1t0vnawi233wa&device_code=...`
```

`renderer.js` — the token object built after a successful device login records the
client id that the token belongs to:

```diff
-                        clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
+                        clientId: 'ue6666qo983tsx6so1t0vnawi233wa',
```

## 3. Login dialog hygiene (`renderer.js`)

* **Single-flight guard.** Clicking `Login` (or `Log In Again`) several times used to
  start several overlapping flows, each of which opened a browser tab.

  ```js
  let deviceAuthFlowActive = false;
  // ...
  if (deviceAuthFlowActive) {
      addLog('[DeviceAuth] A login request is already in progress.', 'info');
      return;
  }
  deviceAuthFlowActive = true;
  ```

* **No automatic browser tab.** The old countdown called
  `window.electronAPI.openExternal(currentVerificationUrl)` by itself; it is gone.
  The `Open twitch.tv/activate` button still does it, on demand.

* **Code copied to the clipboard** as soon as it is issued, via a new IPC call
  (`main.js` uses Electron's own clipboard, which needs no user gesture):

  ```js
  main.js:    ipcMain.handle('copy-to-clipboard', (event, text) => {
                clipboard.writeText(String(text == null ? '' : text)); return true; });
  preload.js: copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  renderer.js: codeCopied = await window.electronAPI.copyToClipboard(currentDeviceUserCode);
  ```

## 4. Silent auto-connect (`main.js`, appended at the end)

The app has no UI for a normal Twitch sign-in, but farming needs a real signed-in
viewer session in the app's own profile (`%APPDATA%\twitch-drop-farmer`), because the
hidden farm window loads `https://www.twitch.tv/<streamer>` and Twitch only credits
watch time to a logged-in session.

On startup the app now reads the stored `auth-token` cookie from its own profile,
verifies it with `{ currentUser { id login } }` and feeds it to the existing renderer
token pipeline (`auth-token-captured`) — exactly the same code path live traffic uses:

```js
const authCookie = (await session.defaultSession.cookies.get({ name: 'auth-token' }))
                     .find(c => /twitch\.tv$/.test(c.domain));
// ... POST https://gql.twitch.tv/gql  with  Authorization: OAuth <cookie>
mainWindow.webContents.send('auth-token-captured', {
  auth: 'OAuth ' + authCookie.value, integrity: '', clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko', deviceId
});
```

Nothing is opened — no window, no tab, no device code. Integrity tokens are still
refreshed the original way (hidden window + request interceptor).

If the profile has no usable session, the app simply stays on *Not Connected*; the
opt-in flag `--twitch-login` shows a one-time Twitch sign-in window (it is also the
only way to create the profile session in the first place). It is never opened
automatically.

---

## Verified locally

* Anonymous device request with the TV client returns a `user_code` (the web client
  id returns `invalid client`).
* Device login end-to-end: code shown → copied to the clipboard → authorized in the
  browser → `⚡ Twitch Device Authorization successful!` → `Logged in as <name>` →
  WebSocket subscribed to `user-drop-events.<id>`.
* Silent auto-connect: `[AutoConnect] Connected as <name>` on a plain launch, with no
  extra window or tab in the window list, campaigns loading, integrity refreshed
  (`integrityLen: 500`).
* The app's profile session was confirmed live against GQL
  (`currentUser` returned the account), which is what makes the hidden farm window
  count watch minutes.
