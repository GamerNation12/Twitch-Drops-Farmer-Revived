# Publishing this build

Two things get published: the **source repo** (so people can read/build/modify it)
and the **built `.exe`** (so non-technical people can just download and run).

## 1. Push the source to GitHub

Create an empty repository at <https://github.com/new>
(for example `twitchdropsfarmer-fixed`) — do **not** let GitHub add a README,
`.gitignore` or license, this repo already has them. Then:

```powershell
cd "C:\Users\minec\Desktop\Twitch Drops Miner\twitchdropsfarmer-fixed"
git remote add origin https://github.com/<YOUR-USER>/twitchdropsfarmer-fixed.git
git push -u origin main
```

If GitHub asks for a password, use a **personal access token**
(Settings → Developer settings → Personal access tokens) instead of your account
password, or sign in with the Git Credential Manager prompt.

## 2. Build the portable exe

```powershell
npm install
npm run dist
```

The result is `dist\TwitchDropsFarmer_v1.3.1.exe` (single portable file, no
installer). First build downloads the electron-builder tooling, so give it a few
minutes.

Smoke-test it before publishing:

1. Run the exe. The app window opens (no black screen — that is fix #1).
2. Press **Start Farm**. It should sign in by itself if you have used it before;
   otherwise run it once with `--twitch-login` and sign in.
3. Check the Console tab: it should show the campaigns loading and no
   `AUTH_EXPIRED` / `invalid client` errors.

## 3. Attach the exe to a Release

GitHub rejects files over 100 MB inside the repository itself, but a **release
asset** may be up to 2 GB, so publish it as a release:

1. On the repo page: **Releases → Draft a new release**.
2. Tag: `v1.3.1` (matches `package.json`), title: whatever you like.
3. Write the notes (you can copy the "What was broken, and what is fixed" table
   from `README.md`).
4. Drag `dist\TwitchDropsFarmer_v1.3.1.exe` into the assets box, and also attach
   `tools\Sign in to Twitch (first run).bat`.
5. Publish.

Anyone can then download the exe, run it, and use
"Sign in to Twitch (first run).bat" once for the first sign-in.
