# Lightbench Privacy Notice

**Your photos never leave your computer.** Lightbench edits, analyzes and stores everything locally.
There is no account, no cloud sync, no analytics and no telemetry.

## What stays on your computer
- Your photos (Lightbench reads them where they are and never modifies them).
- Your catalog, edits, previews, AI masks and AI Denoise results (`Pictures\Lightbench Library`).
- All AI processing (masking, tagging, search, denoise) runs on your own CPU/GPU.

## What Lightbench downloads from the internet
These are ordinary downloads. No photos or personal data are sent; the servers see only your
IP address and the file requested, as with any download.
- **AI models**, once: when you choose to download them (on first launch or in *Lightbench menu → AI Models*),
  or the first time you use an AI feature. From Hugging Face (huggingface.co) and from Lightbench's releases
  on GitHub (github.com). They are stored on your computer, so AI features then work offline.
- **Map tiles**, only when you open the Map module: from OpenStreetMap (tile.openstreetmap.org).
- **Update check**, at most once a day: Lightbench asks GitHub (api.github.com) for the latest version
  number. Only the app's version is included. Turn it off in *Lightbench menu → Check for Updates…*.

If you never use the AI features or the Map module, Lightbench makes no internet requests for them.

## Feedback
*Send Feedback / Report a Problem* never sends anything by itself. It opens a pre-filled message in your
browser (GitHub) or email app, which you can read and edit before sending. You choose whether to include
the technical details shown (app version, operating system, graphics card, recent error messages — which
can occasionally mention a file name, so glance over them first). No photos or catalog data are included.

## Location data
If your photos contain GPS coordinates, Lightbench shows them on the map. Coordinates are only
used to request the map tiles for the area being viewed. You can remove GPS data from photos
in the Map module. Exported images do not include location or other camera metadata.

## Contact
Questions: latentstudios.hq@gmail.com
