# v1.3.3 — auto-start farming, in-app updates, a real Inventory and a lighter app

Sits on top of `v1.3.2`. Nothing was removed: this build makes the app do the obvious
thing when you open it, closes when you close it, and updates itself.

## New in this build

- **Farming starts when the app opens.** *Start Farming When The App Opens* is its own
  switch in **Settings → Startup & Automation** (it is no longer hidden behind
  "launch with Windows"), it is **on by default**, and existing installs get it turned
  on once. In **Priority** mode it walks your priority list in order and picks the first
  game with an active drop; if your list is empty it says so in the console and starts
  in **Global** mode instead of sitting there doing nothing.
- **The ✕ button now closes the app.** Before, `✕` quietly hid the window to the tray, so
  it looked like the close button was broken. `✕` (and Alt+F4) really quit now — and the
  labelled purple **Background** button is still there for "keep farming, hide the
  window".
- **Updates ask first, then install themselves.** When a new release exists the popup
  offers **Later**, **Skip this one** and **Update to vX.Y.Z & restart**. The app
  downloads the new build with a live progress bar and checks it against the SHA-256
  GitHub publishes for that release. The portable build swaps its own exe (staged and
  verified before the old file is replaced); the installed build runs the new Setup
  silently. Either way the app comes back on the new version — and a bad download leaves
  your working copy untouched. If the build cannot replace itself, the button falls back
  to opening the release page in your browser (as before).
- **A proper Inventory.** Summary strip (rewards collected, game groups, campaigns in
  progress, newest drop), an **In Progress** section with real per-drop progress bars and
  claimed ticks, collapsible game groups, a sort control (recently collected / game A–Z /
  most drops / reward name) and lazy-loaded artwork.
- **Lighter on CPU and memory.** The console keeps the newest 500 lines instead of
  growing forever; the ~90-card campaign grid and the priority list are only rebuilt
  while their view is actually visible (switching back re-renders instantly); the
  campaign refresh interval went from 30s to 45s; inventory and priority artwork load
  lazily; scrollbars, focus rings and view transitions were tidied up app-wide.

## Fixed

- `✕` / taskbar Close no longer leaves the app running invisibly in the tray.
- Auto-start farming no longer depends on launching with Windows.
- The app no longer quits into a half-state: closing destroys the hidden farm/claim
  windows and exits cleanly.
- Inventory artwork falls back gracefully instead of showing broken-image icons, and
  claimed drops keep the image Twitch stored with them.
- Group headers on the Inventory page collapse/expand correctly (including game names
  with quotes/apostrophes).
- Farming no longer slows to a crawl while the window is hidden in the tray: Chromium
  was throttling the app's timers to about once a minute when the window was not
  visible, and the main window now opts out of that (the hidden farm window already did).

## Download

Two builds, same app — take whichever you prefer:

- **`TwitchDropsFarmer_Setup_v1.3.3.exe`** — the installer. Installs just for your user
  (no admin prompt), adds Start Menu and desktop shortcuts, and updates itself from
  inside. Uninstalling keeps your Twitch login.
- **`TwitchDropsFarmer_v1.3.3.exe`** — portable: one file, nothing to install. Run it
  from anywhere (a USB stick works) and it updates itself in place.

(If Windows SmartScreen warns about an unknown publisher, choose
*More info → Run anyway*; these exes are unsigned, like the original.)

## How to use it

1. Run `TwitchDropsFarmer_Setup_v1.3.3.exe` (installer) or
   `TwitchDropsFarmer_v1.3.3.exe` (portable).
2. If the header does not show your account, press **Login** — the activation code is
   already on your clipboard, paste it at <https://www.twitch.tv/activate>.
3. Farming starts on its own if *Start Farming When The App Opens* is on (it is by
   default) — otherwise press **Start Farm**. Put your games in the priority list under
   **Settings** to control what it farms first.
4. Use **Background** to keep farming with the window out of the way. **✕** quits.
5. When a new version is published, the app offers it on its own — press **Update now**
   and it will restart itself on the new build.

Automating drops may not be allowed by Twitch's Terms of Service — use at your own
risk. Based on [lokalizator-repo/TwitchDropsFarmer](https://github.com/lokalizator-repo/TwitchDropsFarmer)
`v1.3.0` (ISC License, author *Lokalizator*); this build keeps the same license.
