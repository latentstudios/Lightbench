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

## Optimized AI Denoise models (one-time upload)

Lightbench's faster AI Denoise models are too big for the code repository, so they live in their own
GitHub release. The app falls back to the original (slower) model until they're uploaded.

1. On github.com: **Releases → Draft a new release**.
2. *Choose a tag* → type `models-v1` → *Create new tag*. Title: `AI models (v1)`.
3. Drag in both files from the `model-uploads` folder: `scunet_color_real_psnr_768_fp16.onnx` and
   `scunet_color_real_gan_768_fp16.onnx`.
4. **Tick "Set as a pre-release"** (so the website keeps pointing at the real app release), then **Publish release**.

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

## Before each release
1. Build and launch the packaged app locally (`npx electron-builder --win dir`, then run `dist\win-unpacked\Lightbench.exe`)
   — some bugs only show up in the installed app, not when running from source.
2. After the Release workflow, install from the website and smoke-test (import, AI mask, AI Denoise, export).
3. Upload the new installer to virustotal.com and submit it at microsoft.com/wdsi/filesubmission ("Software developer").
4. Post in Discord #announcements.

## Good to know
- If many people use the Map module, switch to a commercial tile provider with a free tier (MapTiler, Stadia,
  Thunderforest); OpenStreetMap's own tile servers don't allow heavy app use.
- Don't use other companies' product names or logos in the app name, icon or marketing.
- Website and README screenshots use the author's own photos (`website/assets/`); replace them freely.
