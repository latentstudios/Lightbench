# Publishing Lightbench (website + Windows & Mac downloads)

Everything is free: GitHub hosts the code, builds the Windows **and** Mac installers on its own machines
(you don't need a Mac), stores the downloads, and hosts the website.

## One-time setup (≈15 minutes)

1. **Create a GitHub account** at <https://github.com> (pick the username you want in the URLs).
2. **Install GitHub Desktop**: <https://desktop.github.com>, then sign in.
3. **Fill in three placeholders** (search for `YOUR-GITHUB-USERNAME` and `your contact email`):
   - `package.json` → `"owner": "YOUR-GITHUB-USERNAME"`
   - `website/config.js` → `repo: 'YOUR-GITHUB-USERNAME/lightbench'`
   - `app/legal/PRIVACY.md` → `[your contact email here]`
4. **Put the project on GitHub**: GitHub Desktop → *File → Add local repository…* → choose the
   `Lightbench` folder on your Desktop → *create a repository* (name it **lightbench**) → **Publish repository**.
   - Untick *"Keep this code private"* (see "Public or private?" below).
   - Tip: you can create a free GitHub *organization* for your company (e.g. **latentstudios**) and publish
     the repo there, so the URLs read `github.com/latentstudios/lightbench` (then use that name in step 3).
5. **Turn on the website**: on github.com open the repo → *Settings → Pages* → *Source:* **GitHub Actions**.
   Your site will be at `https://YOUR-GITHUB-USERNAME.github.io/lightbench/` a minute later
   (Actions tab → "Website" shows progress).

## Releasing a version

1. Change `"version"` in `package.json` (e.g. `1.0.2`), write what changed in `RELEASE_NOTES.md`
   (people see it on the Releases page and in the app's *Update Available* window), then commit + push in GitHub Desktop.
2. On github.com: **Actions → Release → Run workflow**.
3. ~15 minutes later the Windows installer and both Mac disk images appear under **Releases**, and the
   website's download buttons automatically point to them (they always link to the latest release).

The download file names are fixed so the website never needs editing:
`Lightbench-Setup-win-x64.exe`, `Lightbench-mac-arm64.dmg` (Apple silicon), `Lightbench-mac-x64.dmg` (Intel).

## Public or private?

- **Public repository (simplest, free):** downloads and the website just work. Your source code is visible,
  but it's still yours — the license agreement forbids redistributing or reselling it.
- **Closed source:** keep this repo private and create a second, public repo (e.g. `lightbench-downloads`) that
  only holds releases and the website. This needs a personal access token and a small workflow change —
  ask and it can be set up.

## About the Mac version

- It's built automatically by GitHub on a real Mac. It hasn't been tested on a Mac yet — please try it on one
  before announcing it.
- Without an Apple Developer account ($99/year) the app isn't notarized, so the first launch needs
  *right-click → Open* (the website's FAQ explains this to users). With an account, add the signing secrets
  listed in `.github/workflows/release.yml` and the warning goes away.

## Windows "unknown publisher" warning

Same idea: an Authenticode code-signing certificate removes the SmartScreen warning. Optional.
