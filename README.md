# vizstudio

A layered music-visualizer video editor. Everything runs in the browser: audio
analysis, rendering and MP4 encoding happen on the visitor's machine, so the
site is static files and uploads never leave the device.

## Features

- **Templates**: a gallery of starting layouts (Classic, Vinyl, Karaoke, Neon,
  Poster, Video loop). Applying one keeps your song, artwork, clip, lyrics,
  title and socials, and undo restores the previous layout.
- **Layers**, stacked and blended: Milkdrop visualizer (395 Butterchurn presets,
  optional timed preset changes), images and logos (PNG, SVG, JPG, WebP), text,
  timed lyrics, socials with platform icons, waveform (live oscilloscope or
  whole-song progress), spectrum (bars, mirrored, radial ring, line) and VU meter
  (LED, bar, analogue needles), looping video backgrounds (MP4, MOV, WebM) and
  particles (dust, bokeh, embers, snow, starfield warp).
- **Custom fonts**: upload TTF, OTF, WOFF or WOFF2 files and pick them in any
  text, lyrics or socials layer. They're stored with the other files.
- **Per-format layouts**: each layer has its own position in landscape 16:9,
  portrait 9:16 and square 1:1, so one project exports every format.
- **Lyrics**: LRC (including enhanced LRC word timing for karaoke), SRT and VTT,
  with a sync offset.
- **Export**: H.264 MP4 with AAC audio, 720p to 4K, 24/30/60 fps, whole song or
  a 15-second preview. Several formats can be rendered in one go.
- Undo/redo, autosave (layout in localStorage, files in IndexedDB), layout
  save/load as JSON, snapping guides, keyboard nudging.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Layout

| Path | Purpose |
|---|---|
| `src/types.ts`, `src/defaults.ts` | Project model, layer defaults, starter template |
| `src/templates.ts` | Template gallery layouts and how they adopt the current project's files |
| `src/audio/analysis.ts` | Decoding, FFT, per-frame levels, whole-song overview |
| `src/audio/lyrics.ts` | LRC/SRT/VTT parsing |
| `src/render/compositor.ts` | Draws a project frame; shared by preview and export |
| `src/render/layers.ts` | Drawing code for each layer type |
| `src/render/milkdrop.ts` | Butterchurn wrapper with deterministic preset changes |
| `src/render/particles.ts` | Particle fields computed from time, so export matches preview |
| `src/export/exportVideo.ts` | Offline frame-by-frame render and MP4 encode (Mediabunny) |
| `src/export/clipReader.ts` | Exact frame decoding for video layers during export |
| `src/selftest.ts`, `selftest.html` | Browser export self-test (dev server only) |
| `src/ui/` | Editor components |

## Browser self-test

With `npm run dev` running, open `/selftest.html` in the browser under test and
keep the tab in front. It checks WebCodecs support and encodable codecs, then
exports real MP4s: a deterministic scene whose decoded frame is compared with a
direct render (this catches blank frames and swapped colour channels), every
template including Milkdrop, a looping video background decoded from an MP4,
and loading an uploaded font. Results appear on the page and are saved to
`selftest-results/`.

Last run on 2026-09-29, macOS 26.5 on Apple M3, 720p30:

| Browser | Result | ms/frame, templates | Notes |
|---|---|---|---|
| Safari 27.0 | 6/6 pass | 19–65 | AAC audio, fast frame-copy path; glow- and shadow-heavy layouts are slowest |
| Chromium 152 (Electron) | 6/6 pass | 3–10 | |

## Notes

- Preview and export use the same compositor. Export steps time at a fixed
  frame rate, so its output doesn't depend on how fast the machine renders.
- Export copies each canvas frame into CPU memory before encoding. In Chrome on
  Apple silicon that measured ~6 ms/frame at 1080p against ~75 ms/frame for
  passing the canvas to the encoder directly.
- Video layers play a muted `<video>` in preview, kept within 0.3 s of the
  playhead. Export decodes the clip with Mediabunny and uses the exact frame
  for each output frame.
- Browsers without an audio encoder export silent video; the export dialog
  says so next to the download.
- Milkdrop output isn't bit-identical between preview and export, because each
  one runs its own Butterchurn instance, but preset choices and timing match.
