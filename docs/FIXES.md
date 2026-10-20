# What was changed (v1.3.0 → v1.3.5)

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

## 10. Closing the app actually closes it (`main.js`, `preload.js`, `renderer.js`, `index.html`)

The `✕` button (and the `window.on('close')` handler) hid the window to the tray, so the
close button looked broken and the process kept running with no visible window. The two
behaviours are now split, as the buttons promise:

* `✕` → `ipcMain.on('window-quit')` sets `isQuitting`, then `app.quit()`; the window
  `close` handler no longer `preventDefault()`s and calls `app.quit()` itself, because
  the hidden farm/claim windows would otherwise keep the process alive after the main
  window was destroyed;
* **Background** → `ipcMain.on('window-close')` → `mainWindow.hide()`, unchanged, plus
  the one-per-run tray balloon.

Button titles follow: `Close the app (stops farming)` vs
`Minimize to the background (tray) - farming keeps running`.

## 11. Auto-start farming is its own, independent setting (`main.js`, `renderer.js`, `index.html`)

Previously `autoStartFarm` was only honoured when `autoLaunchEnabled` was also true
(`autoStartFarm && autoLaunchEnabled`), it was rendered inside the
`#startupSubSettings` group (disabled-looking whenever "launch with Windows" was off) and
it defaulted to `false`.

* the row moved out of `#startupSubSettings`, so it is always visible and always
  switchable; the mode select (**Priority Queue** / **Global Queue**) enables with it;
* `get-auto-launch` now returns the raw value and defaults it to `true`;
* a one-time migration (`autoStartFarmMigrated`) flips existing installs to `true` once —
  old builds had persisted `false` for everyone who never touched the (disabled) switch —
  and `set-auto-launch` marks the flag so the user's later choice always wins;
* `triggerAutoStartFarm()` can fire when the config arrives (not only on a token event),
  so an already-connected account starts farming immediately;
* if **Priority** is selected but `autoFarmGames` is empty, it logs
  `[Startup] Your priority list is empty — auto-starting in GLOBAL mode.` and farms
  globally instead of idling.

## 12. In-app updater for portable and installed builds (`main.js`, `preload.js`, `index.html`, `style.css`, `renderer.js`)

`electron-updater` does not support the `portable` target, and `process.execPath` points
at the temp folder a portable exe unpacks itself into — not at the file the user
double-clicked. electron-builder exposes the real path in `PORTABLE_EXECUTABLE_FILE`, so:

* `update-capability` reports `canSelfUpdate` and the mode it will use (`portable`,
  `installed`, or `none` for a source checkout);
* `check-for-updates` also returns the asset's `digest` (`sha256:<hex>`), which GitHub
  publishes for release assets;
* `download-update` streams the release asset with `fetch` +
  `stream/promises.pipeline(Readable.fromWeb(...), counter, fs.createWriteStream(...))`
  into `%TEMP%`, emitting `update-progress` events (~5/s) that drive the popup's progress
  bar. `pipeline` only resolves once the file is closed, and the **finished file is hashed
  from disk** and compared with the release `digest`. It also rejects a size that disagrees
  with `content-length`, anything under 10 MB (an error page), and anything that does not
  start with `MZ`. Every check is logged to `%TEMP%\dfr-download.log`;
* `install-update` re-hashes the payload right before using it and then, **with no
  PowerShell, cmd or .bat**:
  * *portable*: stages the verified exe as `<target>.new` (same folder, so the moves are
    atomic), renames the running file to `<target>.old` (allowed while it is in use),
    renames the staged file into place, verifies the landed file's SHA-256, starts it, and
    quits. If anything fails the old name is restored and the working exe is untouched. The
    `.old` file is deleted on the next launch;
  * *installed*: starts the verified Setup itself, detached, with `/S --force-run`, then
    exits. The installer's NSIS script closes every process with the app's exe name, so
    it can replace the files; `--force-run` is what makes a *silent* install start the new
    build afterwards. There is no helper process and no shell at all — just the app and
    the Setup. (An earlier helper ran from the installed exe while waiting for the app to
    exit; that kept the exe open and made the uninstall step fail with code 2.) Leftover
    payloads from a previous update are deleted on the next launch.

  Both paths log every step to `%TEMP%\dfr-update.log` (`COPY_VERIFIED` / `COPY_OK` /
  `SWAP_VERIFIED` / `relaunched` for portable, `INSTALLER_STARTED` for installed);
* if `canSelfUpdate` is false the popup button degrades to *Download vX.Y.Z*, which opens
  the release asset in the browser exactly as before.

## 13. Inventory rewrite (`renderer.js`, `index.html`, `style.css`)

The old view was a flat list of `drop-item-row`s with no summary and no sort. It now
renders, in this order:

* a four-card summary strip (rewards collected / matching, game groups, campaigns in
  progress, newest drop date) — `n Game group`/`n Game groups` pluralised;
* an **In Progress** section built from `dropCampaignsInProgress`, one card per campaign
  with artwork, `x/y drops claimed`, the campaign percentage and a progress bar per drop
  (`min(current, required)/required`, green tick when `self.isClaimed`);
* collapsible game groups with box art, a drop count, the newest date and a rotating
  chevron — state kept in a `Set`, applied with real `addEventListener` handlers (inline
  `onclick` broke on game names containing `'`);
* a sort control (`recent` / `game` / `count` / `name`, persisted as
  `inventorySortMode`) and the existing search, both feeding the same grouping code;
* `loading="lazy" decoding="async"` on every tile image, plus an `error` listener that
  hides dead artwork instead of drawing a broken-image icon.

## 14. Resource use (`renderer.js`)

* `addLog` trims `#logConsole` to the newest `MAX_LOG_ENTRIES` (500) nodes — it used to
  grow unbounded for the whole session;
* `renderCampaignsListItems()` returns early when `campaignsContainer.offsetParent` is
  `null` (another view is open); `switchView('campaigns')` re-renders on the way in, and
  the dashboard counters are still updated;
* the priority chips/grid are only rebuilt while the Settings view is visible, and
  `switchView('settings')` rebuilds them on entry;
* `farmingInterval` went from 30s to 45s;
* `backgroundThrottling: false` on the main window: the farming loop, the campaign
  refresh and auto-claim all run in that renderer, and Chromium throttles hidden
  windows to roughly one timer tick per minute — which made "farming in the tray" crawl
  whenever the window was hidden or covered. The hidden farm/claim windows already had
  this set.

---

## 15. Installed (NSIS) build next to the portable one (`package.json`, `main.js`, `renderer.js`)

The repo shipped one artifact: a portable exe. That is fine for a USB stick but it is not
a normal Windows app — no shortcut, no Start Menu entry, and nothing for "update" to mean
other than replacing the file. `npm run dist` now builds **both**:

* `dist\TwitchDropsFarmer_v<version>.exe` — portable (`portable` target, unchanged);
* `dist\TwitchDropsFarmer_Setup_v<version>.exe` — an NSIS installer (`nsis` target):
  `oneClick: false` (so the installer has a normal wizard and lets you pick the folder),
  `perMachine: false` (per-user, no UAC prompt), `allowToChangeInstallationDirectory`,
  Start Menu + desktop shortcuts (`shortcutName: "Drops Farmer Revived"`),
  `runAfterFinish`, and `deleteAppDataOnUninstall: false` so uninstalling does **not**
  throw away the app's Twitch session in `%APPDATA%\twitch-drop-farmer`.

Because the app is the same (`name` is still `twitch-drop-farmer`), the portable and the
installed copy share that profile — a login made in one works in the other.

The updater now has two modes (`updateMode()` in `main.js`):

* **portable** — `PORTABLE_EXECUTABLE_FILE` is set: download the new portable exe, wait
  for the app to exit, swap the file (details below);
* **installed** — `app.isPackaged` and no such env var: `process.execPath` *is* the real
  installed exe, so the update is the new **Setup**. The app re-checks the Setup's hash,
  starts it detached with `/S --force-run`, and quits; the installer closes the app,
  replaces the files, and starts the new build itself;
* **none** — running from source: `canSelfUpdate` is false and the popup button falls back
  to the release page, exactly as before.

`check-for-updates` returns `mode`, `assetName` and `isInstaller`, and picks the asset that
fits the running build (`*_Setup_*.exe` for installed builds, `TwitchDropsFarmer_v*.exe`
otherwise) instead of "the first .exe in the release".

The updater script logs to `%TEMP%\dfr-update.log`:
`INSTALLER_STARTED pid=… args=/S --force-run` for installed builds,
`COPY_VERIFIED` / `SWAP_VERIFIED` / `relaunched` for portable ones. The installed build
cannot log the installer's exit code: the NSIS installer closes every process with the
app's exe name before it replaces the files, and the app is one of them.

### Never install a bad file

Both paths verify before they touch anything that works:

* the download is written through `stream/promises.pipeline()` — which only resolves once
  the destination file has been closed — and the **finished file is hashed from disk** and
  must match the `sha256:` GitHub publishes for the asset (`check-for-updates` returns it);
  a mismatch, a size that disagrees with `content-length`, a file under 10 MB, or a file
  that does not start with `MZ` is discarded. Everything is logged to
  `%TEMP%\dfr-download.log`, and the download is retried once on a fresh path
  (`...-retry2.exe`). That replaced an earlier version that hashed the stream *and* read
  the file back immediately: a real 1.3.3 Setup download then produced the correct stream
  hash but a wrong on-disk hash twice in a row (right size, different bytes), so the check
  was right to refuse it — but the race is gone now that the hash is taken from a closed
  file;
* the portable swap stages the new exe as `<exe>.new` **next to** the target, verifies that
  staged file, and only then moves it over the real exe;
* the installed build verifies the Setup's hash before running it.

If verification fails the app simply keeps running the version it has.

---

## 16. Priority games: search the whole directory, with real box art (`main.js`, `preload.js`, `renderer.js`)

The priority list only ever saw games that came back in `ViewerDropsDashboard`, i.e. games
that have a drop campaign *right now*. Two consequences:

* typing the name of any other game in **Settings → Priority Auto-Farm Games** found
  nothing, so it had to be typed exactly and blindly;
* the chips got their icon from `allCampaigns.find(...)`, so a game without a campaign
  showed the placeholder rectangle (Marvel Rivals had art, Fortnite and Rocket League did
  not).

`search-games` (main process) now posts a `SearchCategories` query to
`https://gql.twitch.tv/gql` with the public web `Client-Id` and **no Authorization header**
— Twitch's directory search is public, so it works before login and cannot break the
app's session. It returns `{ id, name, displayName, boxArtURL }` and caches answers for 10
minutes (max 200 queries).

In the renderer:

* `renderPriorityGrid()` merges the campaign games with the directory results for the typed
  name (deduplicated by display name). Directory-only games get a small **no drops** tag
  instead of being invisible. Results for a term that is no longer in the box are dropped,
  so a slow answer cannot overwrite newer results.
* the search is debounced (260 ms, minimum 2 characters) and only the newest request is
  allowed to render (`gameSearchSeq`).
* `gameArtCache` (localStorage) remembers `{ id, boxArtURL, displayName }` per game as soon
  as it is seen — from the campaign feed *or* from a search result. `renderPriorityChips()`
  reads that cache, so chips have real artwork without any campaign, and the icons are
  still there on the next launch (offline included).
* every priority game with no cached art is looked up in the background, one request at a
  time (`queueArtLookup`), and the chips re-render as each icon arrives.
* `loading="lazy"` on the grid images, and the old `onerror` fallback that substituted an
  unrelated game's box art is gone — a failed image now just fades out.

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
* Auto-start farming, live: config `autoStartFarm: true` after the one-time migration,
  the switch renders checked and the mode select enabled, and the console shows
  `🚀 [Startup] Auto-start farming triggered automatically in PRIORITY mode.` followed by
  `Auto-Farm: Switching to Marvel Rivals — next in priority list` and
  `Watching jennie...` within two seconds of launch.
* Inventory, live: summary `114 rewards / 2 game groups / 5 in progress / Oct 19, 2026`;
  five in-progress cards with per-drop bars and green `✓ claimed` ticks; two collapsible
  groups (Marvel Rivals, Other Rewards); 120 images all lazy, 51 loaded on screen;
  sorting by game gave `Marvel Rivals, Other Rewards`, searching `marvel` reduced the
  view to that one group (`3 matching rewards`); collapse set
  `class="inventory-group collapsed"` + `display:none` and toggled back.
* Console cap, live: after 620 `addLog` calls `#logConsole` held exactly 500 entries.
* Campaign render guard, live: with the Dashboard open `applyCurrentFilters()` left
  `#campaignsContainer` at 1 node; `switchView('campaigns')` rendered all 88 cards; the
  Settings priority grid rebuilt on entry.
* No `Runtime.exceptionThrown` events during the whole CDP run.
* Portable updater, live against the real v1.3.2 release asset: `update-capability` →
  `mode: "portable"`, and `%TEMP%\dfr-download.log` shows
  `expected == stream == disk == 2353375087…` (73,560,967 bytes, matching the asset's
  published digest). `%TEMP%\dfr-update.log` shows
  `app exited after 1 checks → COPY_VERIFIED → COPY_OK → relaunched`; the target file on
  disk then hashed exactly the release digest, the payload was deleted, no `.new` file was
  left behind, and the relaunched app was running from the swapped file.
* Download integrity, live: with a deliberately wrong digest the download was refused,
  the file deleted, and no install happened (`The download was corrupted on the way in`).
* Installed build, live: `TwitchDropsFarmer_Setup_v1.3.3.exe /S /D=<temp dir>` installed
  with exit code 0, created the Start Menu + desktop shortcuts and the per-user uninstall
  entry, and the installed app reported `canSelfUpdate: true, mode: "installed"` with
  `target` = its own installed exe. `install-update` then logged
  `INSTALLER_VERIFIED → installer exit code 0 → relaunched` and the app came back running
  from the install directory. A silent uninstall removed the files, both shortcuts and the
  registry entry, and left the app profile (the Twitch login) alone.
* Packaged artifact check (`verify-build.mjs`): 34 checks pass on the built asar, including
  both update modes, the Setup/portable asset choice, the digest + staged-swap verification
  and the NSIS build config; both `dist\TwitchDropsFarmer_v1.3.3.exe` (70.2 MB) and
  `dist\TwitchDropsFarmer_Setup_v1.3.3.exe` (70.4 MB) are present and over 50 MB.
* Game directory search, live: the anonymous `SearchCategories` call (web Client-Id, no
  Authorization) returned Fortnite (`33214`); in the running 1.3.4 dev app, typing
  `rocket league` into Settings produced Rocket League (`30921`) plus four other matching
  titles, all with `ttv-boxart` images that loaded (`naturalWidth > 0`), each tagged
  **no drops** — none of them are in the current campaign feed.
* Priority icons, live: the three existing chips (Fortnite, Marvel Rivals, Rocket League)
  changed from the placeholder rectangle to `33214-36x48.jpg`, `1264310518_IGDB-36x48.jpg`
  and `30921-36x48.jpg`, all loaded, with no campaign needed for two of them.
* Download integrity, live (the exact case that failed before): the 73,838,799-byte
  `TwitchDropsFarmer_Setup_v1.3.3.exe` downloaded twice through the new `pipeline()` path
  and the on-disk SHA-256 matched the published digest both times; the 73,566,359-byte
  portable asset matched three times out of three.
* `verify-build.mjs` on 1.3.4: all checks pass, including the new `search-games` handler,
  the icon cache and the `pipeline` downloader.
* **v1.3.5, clean rebuild:** the earlier `0xC0000005` was a bad build artifact, not the
  installer. A clean `npm run dist` produced a Setup that installed silently
  (`/S /D=<temp dir>`, exit code 0) and reported version 1.3.5.
* **v1.3.5, installed update (the path that used to fail):** installed 1.3.5 to a temp
  directory, let it download the live v1.3.4 Setup (digest matched), and pressed update.
  `%TEMP%\dfr-update.log` showed `INSTALLER_STARTED pid=… args=/S --force-run`; the
  installer replaced the temp install with 1.3.4 in 9 seconds, `--force-run` reopened it,
  CDP answered again on the same port, and no "Failed to uninstall old application files"
  dialog appeared. The old Node helper was removed because it held the installed exe open
  and caused uninstaller exit code 2.
* **v1.3.5, portable update:** the live v1.3.4 portable was swapped into a 1.3.5 copy with
  `COPY_VERIFIED → SWAP_VERIFIED → COPY_OK → relaunched`; the target hashed exactly as the
  release digest, the app came back on the same debug port reporting 1.3.4, and the
  renamed `.old` backup was deleted on the next launch.
* **v1.3.5, updater contents:** `verify-build.mjs` passes 46 checks on the packaged asar,
  including the direct Setup spawn (`/S --force-run`, no helper) and a scan that finds no
  PowerShell, `-NoProfile`, `-ExecutionPolicy`, `.ps1` or `Add-Content` in the update path.
  `dist\TwitchDropsFarmer_v1.3.5.exe` (73,570,401 bytes,
  `31660405…`) and `dist\TwitchDropsFarmer_Setup_v1.3.5.exe` (73,842,837 bytes,
  `cb65975b…`) are both present and over 50 MB.
