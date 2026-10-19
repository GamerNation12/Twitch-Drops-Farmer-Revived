# Twitch Drops Farmer Revived — v1.3.2

A community-fixed, still-working build of **[lokalizator-repo/TwitchDropsFarmer](https://github.com/lokalizator-repo/TwitchDropsFarmer)** `v1.3.0`.

The upstream `v1.3.0` release does not run on most Windows machines and cannot log in
any more. This version fixes both problems, plus the login/auto-connect flow. All the
original features (auto-farming, campaign browser, inventory, priority queue, Discord
RPC, tray auto-start) are untouched.

> If you are only here to *use* it, you don't need this repo — grab the built
> `TwitchDropsFarmer_v1.3.2.exe` from the Releases page, or build it yourself
> (`npm install && npm run dist`).

---

## What was broken, and what is fixed

| # | Problem | Fix |
|---|---------|-----|
| 1 | **Black/empty window on startup.** The shipped build contains only `locales\ru.pak`; on a non-Russian Windows the renderer asks for `en-US.pak`, fails, and crashes with `0xC0000005`. | The build config no longer restricts locales (`electronLanguages: ["en","ru"]` was the culprit), and a prebuilt `en-US.pak` is not needed any more. Running from source also picks up Electron's own locale files. |
| 2 | **Login always failed** with `{"status":400,"message":"invalid client"}`. The app used Twitch's retired web client id for the device-code flow. | The device-code flow now uses the still-working TV client id `ue6666qo983tsx6so1t0vnawi233wa` to request the token. The GQL `Client-Id` stays on the web client id, because every query this app sends is a web query (see #5). |
| 3 | **The login dialog spammed browser tabs.** Every request/retry opened `twitch.tv/activate` in the default browser. | The dialog never opens a browser by itself (there is an "Open twitch.tv/activate" button), only one login request can run at a time, and **the activation code is copied to the clipboard automatically** so you can just paste it. |
| 4 | **No way to stay signed in.** The app has no browser UI for a normal Twitch sign-in, but farming needs the app's own profile to be a signed-in viewer (the hidden farm window only earns watch minutes for a logged-in session). | On startup the app reads the Twitch session already stored in its own profile and connects silently — no window, no tab, no code. If the profile has no session, sign in once with `--twitch-login` (see below). |
| 5 | **"No campaigns found." / inventory icons missing.** A device-code login stored the *TV* client id as the GQL `Client-Id`; Twitch answers web queries sent with it using `dropCampaigns: null` **and no error**, so the app never refreshed its security token and showed nothing. | The GQL client id is pinned to the web client id (an already-stored TV id is migrated), a null/absent `dropCampaigns` now triggers a background security-token refresh, and the inventory asks for `gameEventDrops.imageURL` so every claimed drop shows its real artwork. |
| 6 | **The update check pointed at the dead upstream repo.** | It now checks this repo's GitHub Releases (main process, so it can send a `User-Agent`), at startup and every 6 hours, and links straight to the new download. |
| 7 | **No minimize button, and the app vanished to the tray when you clicked its taskbar icon.** The native title-bar overlay was covered by the app's own header, minimising was intercepted into a tray hide, and relaunching started a second miner. | The header carries its own minimize / **Background** / maximize / close buttons, a plain minimize stays in the taskbar, the labelled purple **Background** button sends the app to the tray (farming keeps running), and a single-instance lock means clicking the app icon again just brings the running window back. |
| 8 | **The header said "Drops Farmer" with a hardcoded `v1.3` badge**, so it never matched the build you were actually running. | It reads **Drops Farmer Revived** and the badge is filled in from the app's own version (`v1.3.2`), which also means the tray tooltip and window title carry the real name. |
| 9 | **You could not see what changed in an update** — an update was a one-line link in Settings. | A changelog popup shows the release notes in the app, with *Later*, *Download vX.Y.Z* and a *Skip this one* checkbox; when you are already up to date, *What's new?* in Settings shows the notes of the version you are running. |

Details and the exact code changes are in [`docs/FIXES.md`](docs/FIXES.md).

---

## Quick start (from source)

Requirements: **Node.js 18+** and Windows x64.

```powershell
git clone https://github.com/GamerNation12/Twitch-Drops-Farmer-Revived.git
cd Twitch-Drops-Farmer-Revived
npm install
npm start
```

To build the portable `.exe` (output in `dist\`):

```powershell
npm run dist
```

Shipping it to other people? [`docs/PUBLISH.md`](docs/PUBLISH.md) has the exact
GitHub steps (repo + Release asset).

---

## Signing in

There are two ways in, and they do different things:

**1. Sign in inside the app once (recommended — this is what makes farming count)**

```powershell
npm run start:signin        # or: Twitch Drops Farmer PRO.exe --twitch-login
```

A Twitch sign-in window opens. Log in there (normal Twitch username/password + 2FA).
The window closes itself as soon as the app picks the session up, the header turns
green and shows your name. The session is stored in the app's own profile
(`%APPDATA%\twitch-drop-farmer`), so you only have to do this once — every later
launch signs in silently and opens nothing at all.

**2. The "Login" button (device code)**

Clicking `Login` requests an activation code from Twitch, copies it to your clipboard
and waits. Paste the code at <https://www.twitch.tv/activate> and the app connects.
This is handy for a quick API login, but note that **watch minutes are only credited
to a viewer that is signed in on the web**, so use option 1 if you want drops to
actually progress.

After either sign-in, press **Start Farm** (or enable auto-farm) and leave it running.

---

## Why the hidden stream window matters

The farmer does not simulate watch events. It opens the streamer's channel in a
hidden Electron window, mutes it, drops the quality to the minimum, dismisses the
"still watching?" prompt, and lets Twitch itself count the watch time. That is only
credited for a signed-in viewer — which is exactly why the profile session from
step 1 above is required. Agents/blockers that break `www.twitch.tv` in embedded
browsers will break farming.

---

## Credits, license, disclaimer

* Original project: **lokalizator-repo/TwitchDropsFarmer** (`v1.3.0`), ISC License,
  author *Lokalizator*. This fork keeps the same license and attribution.
* The login fix (TV client id) mirrors how other Twitch drop miners authenticate.
* Unofficial, not affiliated with Twitch or with the original author. Automating
  drops may conflict with Twitch's Terms of Service — use it on your own account
  and at your own risk. The authors take no responsibility for account actions.
