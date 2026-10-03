# Undertow

![Undertow: Give the track something to look at. Pink and cyan waveform artwork.](https://git.subcult.tv/api/v1/repos/subculture-collective/undertow/raw/docs/assets/readme/banner.png?ref=c46159f6b465ce1d996b8d8c2560db692b57191c)

**Give the track something to look at.**

Undertow is a layered music visualizer editor that runs in your browser. Load a
song, stack visuals behind your artwork, put timed lyrics on top, and render an
MP4 for the full release or a short for the feed.

[Open Undertow](https://undertow.subcult.tv) · [Product overview](https://subcult.tv/products/undertow) · [Feedback and issues](https://git.subcult.tv/subculture-collective/undertow/issues)

![Undertow layered music video editor](https://subcult.tv/screenshots/undertow-editor-1440.webp)

## What's in the box

- **Layers:** Milkdrop presets, spectrum, waveform, VU meters, particles,
  artwork and logos, text, socials, and looping video backgrounds. Stack them,
  blend them, hide the ones you don't want.
- **Lyrics:** LRC, SRT or VTT, with a sync offset. Enhanced LRC word timings
  give word-by-word karaoke.
- **Three frames from one project:** every layer keeps its own position in
  16:9, 9:16 and 1:1, so the landscape cut, the vertical and the square all come
  out of the same file.
- **Templates:** Classic, Vinyl, Karaoke, Neon, Poster and Video loop, for when
  you're in a hurry. Each one carries over your song, artwork, clip and lyrics.
- **Fonts:** six built in, or upload your own TTF, OTF, WOFF or WOFF2.

Undo, snapping guides, browser autosave and layout save/load are there for the
second and third pass.

## It renders on your machine

A local export analyzes, draws and encodes the video in your browser. Your
audio doesn't leave it, and the standalone editor needs no account. Export the
whole song or a 15-second preview as MP4, from 720p to 4K at 24, 30 or 60
frames per second.

Codec support and render speed depend on your browser and hardware. The
exporter asks for H.264 first and falls back to HEVC, VP9 or AV1 if the browser
can't encode it. A browser without an audio encoder produces silent video and
says so in the export dialog. 4K is offered everywhere but not every device can
encode it. See the [browser test notes](DEVELOPMENT.md#browser-self-test).

Optional accounts add a project library and reusable artist defaults; they
store layouts, not media. Cloud rendering is still in testing and live paid
billing is off, so there is no plan to buy. Where it is enabled, a cloud render
uploads the files it needs and deletes those inputs when the job ends. The
[rendering guide](docs/rendering.md) covers that separate workflow.

## Make it your own

Undertow is open source. The standalone editor can run without the account API;
the [development guide](DEVELOPMENT.md) covers local setup, tests, and the shared
preview/export renderer.

- [Account API](docs/api.md)
- [Deployment](docs/deploy.md)
- [Design system](docs/design-system.md)

Built by [Subcult](https://subcult.tv). Licensed under [AGPL-3.0](LICENSE).
