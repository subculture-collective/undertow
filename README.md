# Undertow

**Turn your track into a visual release.**

Undertow is a music visualizer and video editor that runs in your browser. Bring
a song, add artwork and timed lyrics, arrange your layers, and export an MP4 for
a full release or a short social post.

[Open Undertow](https://undertow.subcult.tv) · [Product overview](https://subcult.tv/products/undertow) · [Feedback and issues](https://git.subcult.tv/subculture-collective/undertow/issues)

![Undertow layered music video editor](https://subcult.tv/screenshots/undertow-editor-1440.webp)

## A track, a layout, a video

1. **Start with your sound.** Load a track and choose a template such as Vinyl,
   Karaoke, Neon, Poster, or Video loop.
2. **Build the scene.** Combine audio-reactive visualizers, artwork, logos, text,
   waveforms, spectrum displays, particles, and looping video backgrounds.
3. **Add the words.** Import LRC, SRT, or VTT lyrics, adjust their timing, and use
   custom fonts for your title and text layers.
4. **Make every format.** Give each layer its own position in landscape, portrait,
   and square layouts, then export the formats you need from one project.

Undo, snapping guides, browser autosave, and layout save/load help you refine a
project and return to it later.

## Export on your device

Local exports analyze, render, and encode your media on your own machine. No
account is required for the standalone editor. Export a whole song or a
15-second preview as an H.264 MP4, with options from 720p to 4K and 24, 30, or
60 frames per second.

Codec support and rendering speed depend on your browser and hardware. Browsers
without an audio encoder produce silent video, with a notice in the export
dialog. See the [browser test notes](DEVELOPMENT.md#browser-self-test).

Optional accounts add a project library and reusable artist defaults. Cloud
rendering, when configured for a paid plan, uploads the files needed for the
render and deletes those inputs when the job ends. Read the
[rendering guide](docs/rendering.md) for that separate workflow.

## Make it your own

Undertow is open source. The standalone editor can run without the account API;
the [development guide](DEVELOPMENT.md) covers local setup, tests, and the shared
preview/export renderer.

- [Account API](docs/api.md)
- [Deployment](docs/deploy.md)
- [Design system](docs/design-system.md)

Built by [Subcult](https://subcult.tv). Licensed under [AGPL-3.0](LICENSE).
