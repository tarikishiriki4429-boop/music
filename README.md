# Kotoba Music v3.9.2

Voice-to-instrument / voice editing web app designed for iPad use.

## v3.9.2 fixes

- Unedited voice now bypasses granular pitch processing and stays close to the original recording.
- Reworked high-quality voice pitch shifting with phase-aligned grain spacing.
- Normalized overlap-add prevents edited voice from becoming unusually quiet.
- Added independent Voice Boost control (default 150%).
- Voice crossfades, per-note volume, copy/paste, pitch/timing/length edits remain available.
- Existing v3.9.x project data remains compatible.

## GitHub Pages

Upload the contents of this folder to the repository root. `index.html` is ready to be served by GitHub Pages.

The app does not require a network connection for its audio processing after the page is loaded.

