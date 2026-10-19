# v1.3.2 — window controls, real branding and a changelog popup

This build sits on top of `v1.3.1` (which fixed the black window, login, campaigns and
inventory). Nothing was removed — this is the polish pass for the things that were
still annoying in daily use.

## New in this build

- **A real minimize button.** The header now carries its own window controls
  (`—` / `Background` / `□` / `✕`), because the app draws its own title bar. Minimizing
  minimises normally and the app stays in your taskbar — it no longer disappears just
  because you clicked it.
- **A "Background" button.** Press it and the window goes to the tray while farming
  keeps running. It is labelled on purpose (purple, with the word *Background* on it)
  so nobody has to guess what the icon does. The first time it hides, Windows shows a
  tray balloon telling you where the app went.
- **Only one miner can run.** A single-instance lock means clicking the app icon again
  (taskbar, pinned shortcut, start menu) brings the running window back instead of
  starting a second copy. Clicking the tray icon restores it too; *Quit* lives in the
  tray menu.
- **The header says the real name and the real version.** It reads
  **Drops Farmer Revived** and the badge follows the build (`v1.3.2`) instead of a
  hardcoded `v1.3`. The tray tooltip and the window title use the same name.
- **A changelog popup.** When a new version is out, the app shows what changed —
  the release notes, right in the app — with **Later** and **Download vX.Y.Z** buttons
  and a **Skip this one** checkbox if you would rather not see it again for that
  release. Already up to date? The Settings notice gets a **What's new?** link that
  shows the notes of the version you are running.
- **Header cleaned up.** The *currently farming* pill is properly centred, the header
  clusters all have the same height and rounding, and the window buttons sit on a small
  glass panel instead of floating bare on the bar.

## Download

- **`TwitchDropsFarmer_v1.3.2.exe`** — portable, nothing to install. Run it.
  (If Windows SmartScreen warns about an unknown publisher, choose
  *More info → Run anyway*; the exe is unsigned, like the original.)

> The separate "sign in to Twitch" helper `.bat` is gone — you do not need it. Press
> **Login** in the header and paste the activation code (the app copies it to your
> clipboard for you), or just run the exe: if the app profile already has a Twitch
> session it connects by itself.

## How to use it

1. Run `TwitchDropsFarmer_v1.3.2.exe`.
2. If the header does not show your account, press **Login** — the activation code is
   already on your clipboard, paste it at <https://www.twitch.tv/activate>.
3. Press **Start Farm** (or enable auto-farm) and leave it running. Use the
   **Background** button when you want the window out of the way; farming continues.
   Progress and wallet/claim events show up in the Console tab.

## Everything fixed since v1.3.0

- Black, empty window on startup — the release shipped only the Russian locale and the
  renderer crashed asking for `en-US.pak`.
- Login `invalid client` — the device-code flow now uses the still-working Twitch TV
  client id, while every GraphQL query keeps the web client id.
- Login dialog spamming browser tabs — it never opens a browser on its own and copies
  the activation code to the clipboard.
- Farming not staying signed in — the app signs in silently from the Twitch session
  stored in its own profile, no window and no code.
- Empty campaign list and "failed integrity check" — a null/absent `dropCampaigns`
  now triggers a security-token refresh instead of rendering nothing.
- Missing inventory artwork — drop images come from `gameEventDrops.imageURL`, so all
  claimed drops show their real picture.
- Update check pointed at the dead upstream repo — it now checks this repo's releases.

Automating drops may not be allowed by Twitch's Terms of Service — use at your own
risk. Based on [lokalizator-repo/TwitchDropsFarmer](https://github.com/lokalizator-repo/TwitchDropsFarmer)
`v1.3.0` (ISC License, author *Lokalizator*); this build keeps the same license.
