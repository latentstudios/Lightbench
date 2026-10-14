# Lightbench

Photo library, RAW editor and AI masking for Windows and macOS. Non-destructive editing on the GPU,
true RAW decoding, AI subject/sky/object masks, AI Denoise and natural-language photo search.
Everything runs locally; photos never leave the computer.

**Publishing the website and downloads: see [PUBLISHING.md](PUBLISHING.md).**

## Building
- `npm install` (then `node node_modules/electron/install.js` if npm skipped Electron's download)
- `npm start`: run from source
- `npm run dist:win`: Windows installer → `dist\Lightbench-Setup-win-x64.exe`
- `npm run dist:mac`: macOS disk images → `dist/Lightbench-mac-arm64.dmg`, `dist/Lightbench-mac-x64.dmg` (must run on a Mac;
  the GitHub "Release" workflow does this automatically)

## Project layout
- `desktop.js`: Electron shell (window, menus, single instance) · `server.js`: local file/catalog server
- `app/`: the UI and editing engine · `app/legal/`: license agreement, privacy notice, third-party notices
- `website/`: the product website (published by the "Website" workflow) · `.github/workflows/`: CI

## Where things live (for users)
- Catalog, previews, AI masks: `Pictures/Lightbench Library` (back this folder up to back up edits)
- Photos are read in place and never modified; Export writes new files.

## Licensing
- Lightbench itself: see `LICENSE.txt` (shown during install).
- Third-party software and AI models: `app/legal/THIRD_PARTY_NOTICES.md`, also shown in the app
  (Lightbench menu → About & Licenses) and on the website. **Every bundled library and AI model permits commercial use.**
  Before adding any new model or library, check its license; avoid "non-commercial", "research only",
  CC BY-NC, AGPL and model licenses with use restrictions.
- Privacy notice: `app/legal/PRIVACY.md`.

## Release checklist
1. Bump `version` in `package.json`.
2. Replace the placeholder contact in `app/legal/PRIVACY.md` and the copyright name if needed.
3. Run the **Release** workflow (see PUBLISHING.md), then smoke-test both installers.
4. Optional but recommended: code-sign (Windows Authenticode certificate; Apple Developer ID + notarization),
   so Windows SmartScreen and macOS Gatekeeper don't warn users.
5. If many people will use the Map module, switch to a commercial tile provider with a free
   tier (MapTiler, Stadia, Thunderforest); OpenStreetMap's own tile servers don't allow heavy app use.
6. Don't use other companies' product names or logos in the app name, icon or marketing.
7. Website screenshots use the author's own photos (`website/assets/`); replace them freely.
