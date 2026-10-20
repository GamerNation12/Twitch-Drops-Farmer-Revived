# Publishing this build

Repository: <https://github.com/GamerNation12/Twitch-Drops-Farmer-Revived>

Two things get published: the **source** (so people can read, build and modify it)
and the **built `.exe`** (so non-technical people can just download and run it).

## 1. Push your changes

```powershell
cd "C:\Users\minec\Desktop\Twitch Drops Miner\Twitch-Drops-Farmer-Revived"
git add -A
git commit -m "what you changed"
git push
```

## 2. Build the Windows builds

```powershell
npm install
npm run dist
```

Two artifacts land in `dist\`:

* `dist\TwitchDropsFarmer_v1.3.4.exe` — the **portable** build (one file, no installer);
* `dist\TwitchDropsFarmer_Setup_v1.3.4.exe` — the **installer** (NSIS, per-user, Start
  Menu + desktop shortcut).

The first build downloads the electron-builder tooling (and, for the installer, the NSIS
binaries), so give it a few minutes.

> **npm skipped Electron's download?** Some npm versions block dependency install
> scripts (you'll see `npm warn allow-scripts ... electron@32.3.3 (postinstall)`).
> Fix it once with either:
>
> ```powershell
> npm approve-scripts electron
> npm install
> # or simply:
> node node_modules\electron\install.js
> ```

Smoke-test before publishing:

1. Run the portable exe — the app window opens. (No black screen: that is fix #1.)
2. Install the Setup exe (or `TwitchDropsFarmer_Setup_v1.3.4.exe /S` for a silent
   per-user install) and run it from the Start Menu.
3. If the app does not show your account, run it once with `--twitch-login` and sign
   in (or use the **Login** button in the header: the activation code is copied to
   your clipboard automatically).
4. Console tab: campaigns load, no `AUTH_EXPIRED` / `invalid client` errors.
5. `✕` quits the app (processes gone), `—` minimises to the taskbar and **Background**
   hides it to the tray with the processes still running.
6. With a Twitch session in the profile, farming starts by itself (Settings →
   *Start Farming When The App Opens*).

## 3. Attach the builds to a Release

GitHub rejects files over 100 MB inside the repository, but a **release asset** may
be up to 2 GB — so the exes go into a Release, not into git.

Web UI: **Releases → Draft a new release**, tag `v1.3.4`, paste the notes from
`docs\RELEASE-NOTES-v1.3.4.md`, then drag in **both** `dist\TwitchDropsFarmer_v1.3.4.exe`
and `dist\TwitchDropsFarmer_Setup_v1.3.4.exe`.

Or from the command line (GitHub CLI):

```powershell
gh release create v1.3.4 `
  "dist\TwitchDropsFarmer_v1.3.4.exe" `
  "dist\TwitchDropsFarmer_Setup_v1.3.4.exe" `
  --title "v1.3.4 - search any game, real box art, verified updates" `
  --notes-file docs\RELEASE-NOTES-v1.3.4.md
```

> **The in-app updater depends on this step.** It calls `releases/latest` and picks the
> asset that fits the running build: the portable exe (`TwitchDropsFarmer_vX.Y.Z.exe`)
> for portable builds, the `*_Setup_*.exe` installer for installed builds. Publish the
> release (not a draft) with the same version as `package.json`, and older builds offer
> *Update to vX.Y.Z & restart* and update themselves.

Anyone can then download the exe, run it, and press **Login** in the header if the
app profile has no Twitch session yet (the activation code goes to the clipboard).
