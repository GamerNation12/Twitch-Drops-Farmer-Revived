# v1.3.1 — community-fixed build

Upstream `v1.3.0` does not start on most Windows machines, and its login no longer
works. This build fixes both. All original features are unchanged.

## Download

* **`TwitchDropsFarmer_v1.3.1.exe`** — portable, nothing to install.
  Run it. (If Windows SmartScreen warns about an unknown publisher, choose
  *More info → Run anyway*; the exe is unsigned, like the original.)
* **`Sign in to Twitch (first run).bat`** — optional helper: put it next to the exe
  and double-click it **once** to sign in to Twitch inside the app.

## Fixes in this build

| # | Problem in v1.3.0 | Fix |
|---|-------------------|-----|
| 1 | **Black, empty window on startup.** The release shipped only `locales\ru.pak`; on a non-Russian Windows the renderer asks for `en-US.pak`, fails and crashes with `0xC0000005`. | The build no longer restricts Electron locales (`electronLanguages: ["en","ru"]` was the cause), so `en-US.pak` is always included. |
| 2 | **Login always failed** with `{"status":400,"message":"invalid client"}` — Twitch stopped accepting the app's client id for the device-code flow. | The device-code login, the token poll and the default `Client-Id` header now use the still-working TV client id `ue6666qo983tsx6so1t0vnawi233wa`. |
| 3 | **The login dialog spammed browser tabs** — every attempt opened `twitch.tv/activate` again. | It never opens a browser by itself, only one login request runs at a time, and the activation code is copied to your clipboard automatically. |
| 4 | **Farming could not stay signed in.** The app has no browser UI for a normal Twitch sign-in, but the hidden farm window only credits watch time to a signed-in session. | On startup the app signs in silently from the Twitch session already stored in its own profile — no window, no tab, no code. Sign in once with `--twitch-login` if the profile has no session yet. |

## How to use it

1. Run `TwitchDropsFarmer_v1.3.1.exe`.
2. Not connected? Launch once with `--twitch-login` (or the helper `.bat`) and log in
   on the Twitch page that opens — it closes itself once the app is connected.
3. Press **Start Farm** (or enable auto-farm) and leave it running. Drop progress and
   wallet/claim events show up in the Console tab.

Automating drops may not be allowed by Twitch's Terms of Service — use at your own
risk. Based on [lokalizator-repo/TwitchDropsFarmer](https://github.com/lokalizator-repo/TwitchDropsFarmer)
`v1.3.0` (ISC License, author *Lokalizator*); this build keeps the same license.
