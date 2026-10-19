# What was changed (v1.3.0 → v1.3.2)

Every change below is relative to upstream
`lokalizator-repo/TwitchDropsFarmer@v1.3.0`. Files touched: `main.js`,
`preload.js`, `renderer.js`, `gql-queries.json`, `package.json`.

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

The TV client id is used **only to obtain a token** — every GraphQL query this app
sends is a *web* query, and Twitch answers web queries sent with the TV client id
with `dropCampaigns: null` and no error at all (see §5). So the token request keeps
the TV client id:

```diff
-      body: 'client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&scopes='
+      body: 'client_id=ue6666qo983tsx6so1t0vnawi233wa&scopes=user:read:email'
```

```diff
-      body: `client_id=kimne78kx3ncx6brgo4mv6wki5h1ko&device_code=...`
+      body: `client_id=ue6666qo983tsx6so1t0vnawi233wa&device_code=...`
```

…while the GQL `Client-Id` header stays on the web client id, in `main.js` *and* for
the token object the renderer builds after a successful device login:

```diff
   'Client-Id': tokens.clientId || 'kimne78kx3ncx6brgo4mv6wki5h1ko',   // main.js — unchanged
```

```diff
-                        clientId: 'ue6666qo983tsx6so1t0vnawi233wa',
+                        clientId: WEB_CLIENT_ID,   // 'kimne78kx3ncx6brgo4mv6wki5h1ko'
```

(An earlier build of this fork did store the TV client id as the GQL client id; §5
covers what that broke and the migration that undoes it.)

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

## 5. Empty campaign list, empty inventory, "failed integrity check"

Symptom reported from the real app: header shows the account, but **Active Campaigns**
says *No campaigns found.* and **My Inventory** lists drops with placeholder icons
instead of artwork.

Every query in `gql-queries.json` (`ViewerDropsDashboard`, `Inventory`, …) is a query
the *web* client sends, and Twitch requires the `Client-Id` header, the `Authorization`
token and the `Client-Integrity` token to belong to the same client. A device-code
login had put the TV client id into `tokens.clientId`, which produced this:

```
TV token   + TV  Client-Id : http=200 currentUser=object campaigns=null   (no error!)
TV token   + web Client-Id : http=200 currentUser=object campaigns=null   errors=[failed integrity check]
web token  + web Client-Id : http=200 currentUser=object campaigns=null   errors=[failed integrity check]
```

Two consequences:

1. **`dropCampaigns: null`, no error** → the renderer's `INTEGRITY_REQUIRED` branch
   never ran, so the integrity bot was never asked to refresh, so the app sat in a
   permanent "no campaigns" state.
2. The inventory builds its artwork from `benefitEdges.benefit.imageAssetURL` of
   *currently listed* campaigns; with the campaign list empty, the lookup map was
   empty too. Even with campaigns, only 2 of 111 history items resolved.

Fixes:

* **Web client id everywhere for GQL** (`renderer.js` pins `WEB_CLIENT_ID`, `main.js`
  keeps it as the `buildHeaders` fallback) plus a one-time migration of a client id
  already stored in `localStorage`:

  ```js
  if (accountTokens && accountTokens.clientId !== WEB_CLIENT_ID) {
      accountTokens.clientId = WEB_CLIENT_ID;
      localStorage.setItem('accountTokens', JSON.stringify(accountTokens));
  }
  ```

* **Self-heal on missing data.** A null/absent `dropCampaigns` is now treated like
  `INTEGRITY_REQUIRED` (rate limited to one refresh a minute), so the hidden
  `twitch.tv/drops/inventory` window runs, the interceptor captures a fresh
  `Client-Integrity` (and the web session's auth token), and the next poll succeeds:

  ```js
  const campaignDataMissing = !userData || userData.dropCampaigns == null;
  if (campaignDataMissing && accountTokens && accountTokens.auth && Date.now() - lastIntegrityKick > 60000) {
      lastIntegrityKick = Date.now();
      window.electronAPI.refreshIntegrityToken();
      showLoadingPlaceholder("Validating security token in background...");
      return false;
  }
  ```

  A device login also kicks that refresh straight away instead of waiting for the
  next 30-second poll.

* **Real artwork for every claimed drop.** `gameEventDrops` exposes its own image,
  which the query did not ask for:

  ```diff
  -gameEventDrops { id name lastAwardedAt }
  +gameEventDrops { id name lastAwardedAt imageURL }
  ```

  ```diff
  -            image: itemImageMap.get(item.id) || null
  +            image: item.imageURL || itemImageMap.get(item.id) || null
  ```

## 6. Update check (`main.js`, `preload.js`, `renderer.js`)

The Settings view had a **Check Now** button, but it fetched upstream's
`raw.githubusercontent.com/lokalizator-repo/TwitchDropsFarmer/main/package.json` and
linked to upstream's releases. It now asks a main-process handler, because the GitHub
API requires a `User-Agent` header that the renderer cannot set:

```js
ipcMain.handle('check-for-updates', ...)   // GET /repos/GamerNation12/Twitch-Drops-Farmer-Revived/releases/latest
```

It returns the current version (`app.getVersion()`), the latest tag, a semver
comparison, the release URL, the download URL of the `.exe` asset and the notes. The
renderer turns that into a clickable notice that opens the download directly, and runs
the same check silently 8 s after launch and then every 6 hours.

## 7. Window buttons and taskbar behaviour (`main.js`, `preload.js`, `index.html`, `style.css`, `renderer.js`)

Reported from the real app: *"the app closes to the background when I click the icon on
my taskbar, and there is no minimize button"*. Three separate causes:

* `titleBarStyle: 'hidden'` was combined with `titleBarOverlay`, but the app's own
  50px header sat on top of the overlay area (the CSS even reserved room with
  `margin-right: 140px`), so the native minimise/maximise/close buttons were invisible
  and unclickable.
* The main process intercepted minimising and turned it into a tray hide:

  ```js
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();      // <- the app "closes to the background"
  });
  ```

* There was no `app.requestSingleInstanceLock()`, so clicking a pinned taskbar icon
  while the app sat in the tray started a **second** instance — two miners, two farm
  windows, one account.

Changes:

* The interception is gone, so minimising (the button or a taskbar click) minimises
  like any other window and the app stays in the taskbar where you can click it again.
* `titleBarOverlay` removed; the app draws its own controls in the header:

  | Button | Icon | Action |
  |---|---|---|
  | Minimize | `—` | normal minimise to the taskbar |
  | **Background** | arrow into a tray + the label *Background* | hides the window to the tray, farming keeps running (purple, labelled on purpose — a bare icon left people guessing) |
  | Maximize / Restore | `□` | toggles maximise, icon and tooltip follow the state |
  | Close | `✕` | hide to the tray, same as it always did |

  wired to `window-minimize`, `window-close` and `window-maximize-toggle`:

  ```js
  ipcMain.on('window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
  ipcMain.on('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
  ipcMain.handle('window-maximize-toggle', () => { /* maximize / unmaximize, returns new state */ });
  ```

  The first hide-to-tray of a run also shows a Windows tray balloon so the app does
  not just seem to vanish.
* Single-instance lock, so clicking the app icon again (taskbar shortcut, tray,
  start menu) brings the running window back instead of starting a second miner:

  ```js
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) app.quit();
  else app.on('second-instance', () => { /* restore + show + focus */ });
  ```

* Clicking the tray icon now restores a minimised window instead of hiding it.
  `Quit` lives in the tray menu.

## 8. Header branding (`index.html`, `renderer.js`, `main.js`)

The header still said *"Drops Farmer"* with a **hardcoded** `v1.3` badge, so it never
matched the real build. It now reads **Drops Farmer Revived** and the badge is filled
in at startup from the app's own version:

```js
const badge = document.getElementById('headerBrandVersion');
const version = await window.electronAPI.getAppVersion();   // -> app.getVersion()
if (version) badge.innerText = 'v' + version;
```

The tray tooltip, the tray balloon and the sign-in window title use the same
`BRAND_NAME` constant, and the window title is `Drops Farmer Revived`.

While in there, the header *format* was tidied up:

* the "currently farming" pill is now absolutely centred (`left: 50%` +
  `translateX(-50%)`) instead of drifting around depending on how wide the brand and
  the user widget happen to be;
* the three header clusters had three different corner radii (30px / 20px / 12px) and
  slightly different heights — they are all pills of the same height now, so the row
  reads as one strip;
* the window-controls cluster sits on its own small glass panel instead of floating
  bare on the header.

## 9. Update changelog popup (`main.js`, `preload.js`, `index.html`, `style.css`, `renderer.js`)

An update being available used to be a one-line link in Settings. Now the release
notes are shown in a proper popup, and it opens by itself when a new version shows up:

* the main-process handler already fetched the release body; the notes cap went from
  2000 to 4000 characters so full release notes fit;
* `renderer.js` renders that markdown safely — the text is HTML-escaped **first**, then
  only headings, bullets, bold, `code`, links and `---` are turned into markup, so a
  release can never inject HTML into the app window:

  ```js
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  ```

* the popup shows the version transition (`You have v1.3.1 — v1.3.2 is available`), the
  notes in a scrollable box, a **Skip this one (v1.3.2)** checkbox (remembered in
  `localStorage` under `dfr.dismissedUpdateVersion`), **Later**, and a
  **Download vX.Y.Z** button that opens the release asset directly;
* it closes with `Esc`, the overlay click, or *Later*;
* the same popup doubles as a changelog viewer: when you are already up to date the
  Settings notice gets a **What's new?** link that opens the notes of the version you
  are running (`What's new in v1.3.2`, no skip checkbox, button reads *Open release
  page*);
* a silent background check pops it up only if that exact version was not skipped — a
  manual **Check Now** always shows it.

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
* Campaigns: **89 campaign cards** rendered after the client-id/integrity fix
  (`campaignsContainer` no longer shows "No campaigns found."), with
  `hasIntegrity: true, integrityLen: 500` in the request log and
  `[IntegrityBot] Captured new integrity token successfully!`.
* Inventory: **111 of 111 rows now render a real image** (previously 2 of 111, the
  rest placeholders), all of them `static-cdn.jtvnw.net/twitch-quests-assets/...`
  and all reported `complete && naturalWidth > 0` in the rendered DOM.
* Window controls, driven over CDP against a live window: the four buttons exist,
  are inside the viewport and are `no-drag`; the *Minimize* button minimises (the app
  stays in the taskbar) and the **Background** button hides the window while the
  Electron processes keep running (farming continues). Launching the app a second time
  while it is minimised *and* while it is in the tray brought the same window back —
  `[SingleInstance] second launch detected - restoring the running window` in the log,
  no extra process, no second miner.
* Header: the farm pill reports a centre of 600.5px in a 1200px window (i.e. centred),
  all three header clusters are 34px tall and vertically centred at y=25, and the
  window-controls panel's right edge is 16px from the window edge.
* Branding: `app.getVersion()` → `1.3.2`, badge reads `v1.3.2`, window title
  `Drops Farmer Revived`, tray tooltip / balloon / sign-in window title all use
  `BRAND_NAME`.
* Changelog popup, against the **live GitHub release**: *Check Now* on v1.3.2 returned
  "You have the latest version (v1.3.2). **What's new?**", and clicking that opened the
  popup titled *What's new in v1.3.2* with the real 3.7 KB release notes rendered as
  headings/lists/links, the skip row hidden and the button reading *Open release page*.
  A simulated newer release produced *Update available / You have v1.3.0 — v1.3.2 is
  available / Skip this one (v1.3.2) / Download v1.3.2*, and `Esc` closed it. Markdown
  injection check: `<b>raw html</b>` in a release body came out as `&lt;b&gt;` text.
