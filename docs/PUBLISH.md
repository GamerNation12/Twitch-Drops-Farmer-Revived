# Publishing this build

Repository: <https://github.com/GamerNation12/Twitch-Drops-Farmer-Revived>

Two things get published: the **source** (so people can read, build and modify it)
and the **built `.exe`** (so non-technical people can just download and run it).

## 1. Push your changes

```powershell
cd "C:\Users\minec\Desktop\Twitch Drops Miner\twitchdropsfarmer-fixed"
git add -A
git commit -m "what you changed"
git push
```

## 2. Build the portable exe

```powershell
npm install
npm run dist
```

The result is `dist\TwitchDropsFarmer_v1.3.1.exe` — a single portable file, no
installer. The first build downloads the electron-builder tooling, so give it a few
minutes.

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

1. Run the exe — the app window opens. (No black screen: that is fix #1.)
2. If the app does not show your account, run it once with `--twitch-login` and sign
   in (or use the **Login** button in the header: the activation code is copied to
   your clipboard automatically).
3. Console tab: campaigns load, no `AUTH_EXPIRED` / `invalid client` errors.

## 3. Attach the exe to a Release

GitHub rejects files over 100 MB inside the repository, but a **release asset** may
be up to 2 GB — so the exe goes into a Release, not into git.

Web UI: **Releases → Draft a new release**, tag `v1.3.2`, paste the notes from
`docs\RELEASE-NOTES-v1.3.2.md`, then drag in `dist\TwitchDropsFarmer_v1.3.2.exe`.

Or from the command line (GitHub CLI):

```powershell
gh release create v1.3.2 `
  "dist\TwitchDropsFarmer_v1.3.2.exe" `
  --title "v1.3.2 - window controls, branding, changelog popup" `
  --notes-file docs\RELEASE-NOTES-v1.3.2.md
```

Anyone can then download the exe, run it, and press **Login** in the header if the
app profile has no Twitch session yet (the activation code goes to the clipboard).
