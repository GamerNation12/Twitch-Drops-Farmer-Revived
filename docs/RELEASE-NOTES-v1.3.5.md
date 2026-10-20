# v1.3.5 — search any game, real box art, and an updater without PowerShell

Sits on top of `v1.3.4`. The priority list no longer depends on what happens to have a
drop campaign right now, and updating no longer starts a hidden `powershell.exe`.

## New in this build

- **Search the whole Twitch game directory.** The box under *Priority Auto-Farm Games*
  now asks Twitch for games by name as you type (no login needed for the lookup), so a
  game shows up even when it has no active drops at the moment. Previously the list only
  knew about games that were in your current campaign feed, so anything else could not be
  found — you had to type the exact name and hope.
- **Every priority game gets its real box art.** The chips used to show a generic
  placeholder unless the game happened to have a campaign loaded. Now each game's icon is
  fetched from the directory once and cached locally, so the chips have their artwork
  immediately on the next launch — even offline.
- **"no drops" instead of "not there".** Search results that have no active campaign are
  marked with a small `no drops` tag, so you can still queue the game (it will be picked
  up as soon as a campaign appears) without wondering why nothing is being farmed.
- **Artwork is lazy-loaded** in the results grid, matching the rest of the app.

## No PowerShell in the updater

The old updater wrote a `.ps1` file to `%TEMP%` and started `powershell.exe` with
`-ExecutionPolicy Bypass` to wait for the app to close and swap the file. It was hidden, but
it was still a PowerShell process using exactly the flags malware uses — bad for trust and
for antivirus heuristics. It is gone, with no replacement shell of any kind:

- **Portable build:** the app stages the verified new exe next to itself, renames the old
  file aside (Windows allows renaming a file that is in use, just not deleting it), swaps
  the new one in, starts it and quits. The leftover `.old` file is removed on the next
  launch.
- **Installed build:** the app re-checks the Setup's SHA-256, starts the Setup itself with
  `/S --force-run`, and quits. The installer closes the running app, replaces the files,
  and `--force-run` makes the silent install reopen the new build. There is no helper
  process at all — just the app and the Setup, so nothing appears as `powershell.exe`.

No PowerShell, `cmd`, `.bat`, `.vbs` or scheduled task is used at any point.

## Fixed

- **Updates are verified from the file on disk before anything is replaced.** The
  downloader now writes the payload through a pipeline that only finishes when the file is
  closed, then hashes that file and compares it with the SHA-256 GitHub publishes for the
  release. This closes a real failure where a download could hash correctly in memory but
  land slightly wrong on disk — the app correctly refused to install it, but it meant a
  retry was needed. Three consecutive downloads of both assets hashed exactly right after
  the change.

Drop progress itself is unchanged and still real-time: the app keeps a WebSocket
subscription to your drop events, with the 45s campaign/inventory polling as a fallback.

## Download

Two builds, same app — take whichever you prefer:

- **`TwitchDropsFarmer_Setup_v1.3.5.exe`** — the installer. Installs just for your user
  (no admin prompt), adds Start Menu and desktop shortcuts, and updates itself from
  inside. Uninstalling keeps your Twitch login.
- **`TwitchDropsFarmer_v1.3.5.exe`** — portable: one file, nothing to install. Run it
  from anywhere (a USB stick works) and it updates itself in place.

(If Windows SmartScreen warns about an unknown publisher, choose
*More info → Run anyway*; these exes are unsigned, like the original.)

## Coming from v1.3.2 or older?

Those builds only had a link to GitHub, so **their Download button always opens the
release page in your browser** — that is expected and cannot be changed after the fact.
Install v1.3.5 once by hand (either file above). From v1.3.5 onward the button downloads,
installs and restarts the app by itself, with no browser trip.

## How to use it

1. Run `TwitchDropsFarmer_Setup_v1.3.5.exe` (installer) or
   `TwitchDropsFarmer_v1.3.5.exe` (portable).
2. If the header does not show your account, press **Login** — the activation code is
   already on your clipboard, paste it at <https://www.twitch.tv/activate>.
3. In **Settings → Priority Auto-Farm Games**, type a game name. Results appear below
   with their box art; click one (or press Enter to add the typed name). Farming starts on
   its own if *Start Farming When The App Opens* is on.
4. Use **Background** to keep farming with the window out of the way. **✕** quits.
5. When a new version is published, the app offers it on its own — press **Update now**
   and it will restart itself on the new build.

Automating drops may not be allowed by Twitch's Terms of Service — use at your own
risk. Based on [lokalizator-repo/TwitchDropsFarmer](https://github.com/lokalizator-repo/TwitchDropsFarmer)
`v1.3.0` (ISC License, author *Lokalizator*); this build keeps the same license.
