# v1.3.4 — search any game, real box art in the priority list

Sits on top of `v1.3.3`. The priority list no longer depends on what happens to have a
drop campaign right now.

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

- **`TwitchDropsFarmer_Setup_v1.3.4.exe`** — the installer. Installs just for your user
  (no admin prompt), adds Start Menu and desktop shortcuts, and updates itself from
  inside. Uninstalling keeps your Twitch login.
- **`TwitchDropsFarmer_v1.3.4.exe`** — portable: one file, nothing to install. Run it
  from anywhere (a USB stick works) and it updates itself in place.

(If Windows SmartScreen warns about an unknown publisher, choose
*More info → Run anyway*; these exes are unsigned, like the original.)

## How to use it

1. Run `TwitchDropsFarmer_Setup_v1.3.4.exe` (installer) or
   `TwitchDropsFarmer_v1.3.4.exe` (portable).
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
