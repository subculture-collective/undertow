> For the product overview, see the [README](README.md).

# Undertow

A layered music-visualizer video editor. Audio analysis, rendering and MP4
encoding happen in the browser, on the visitor's machine. Local exports keep
media on the device. Cloud exports upload the files needed by the render,
then delete the inputs when the job ends. Optional accounts store project layouts and defaults through
the Undertow API (`server/`), which is also usable by other apps with API keys.

## Features

- **Templates**: a gallery of starting layouts (Classic, Vinyl, Karaoke, Neon,
  Poster, Video loop). Applying one starts a new project with your song,
  artwork, clip, lyrics, title and socials; the previous project stays in
  Projects. Media the template has no place for (a clip, extra lyrics, a logo)
  comes along as a hidden layer in the same position.
- **Layers**, stacked and blended: Milkdrop visualizer (395 Butterchurn presets,
  favourites starred per browser, optional preset changes every few seconds or every
  few bars of the song's detected tempo, from all presets or the favourites saved
  with the project), images and logos (PNG, SVG, JPG, WebP), text,
  timed lyrics, socials with platform icons, waveform (live oscilloscope or
  whole-song progress), spectrum (bars with optional LED segments, peak caps and reflection;
  mirrored, radial ring, line; bar count or 1/3- and 1/6-octave bands) and VU meter
  (LED, bar, analogue needles), looping video backgrounds (MP4, MOV, WebM) and
  particles (dust, bokeh, embers, snow, starfield warp).
- **Stem-reactive layers**: spectrum, waveform, VU, particles, Milkdrop, image
  and video layers can follow one stem (drums, bass, vocals, other) instead of
  the mix ("Reacts to" in the inspector). "Separate stems" splits the song in a
  Web Worker on WebAssembly, saves the stems in IndexedDB under the song's
  asset id and reuses them after a reload. Layers without a separated stem
  follow the mix and the inspector says so. Export uses the same stems; the
  exported audio is the original mix. Cloud renders don't have stems yet, so
  they use the mix. See [Stem separation](#stem-separation).
- **Effects** over the whole frame, after all layers: film grain, colour split
  (chromatic aberration, optionally widened by bass), scanlines with CRT
  curvature, and vignette. One WebGL2 pass, the same in preview and export.
  With every effect off no WebGL context is created.
- **Custom fonts**: upload TTF, OTF, WOFF or WOFF2 files and pick them in any
  text, lyrics or socials layer. They're stored with the other files.
- **Per-format layouts**: each layer has its own position in landscape 16:9,
  portrait 9:16 and square 1:1, so one project exports every format.
- **Lyrics**: LRC (including enhanced LRC word timing for karaoke), SRT and VTT,
  with a sync offset.
- **Lyric timing editor** ("Edit timing…" on a lyrics layer): paste plain text
  or start from the layer's file, stamp line starts with Space while the song
  plays (0.5×, 0.75× or 1×), then drag lines, or their ends, on a zoomable
  waveform. The stage previews the edit. Saving writes a new LRC file, points the
  layer at it (undoable) and leaves the original untouched; the file can also be
  downloaded. Other code opens it with `openLyricEditor()` in
  `src/ui/LyricTimingEditor.tsx`.
- **Export**: MP4 (H.264 with AAC audio where the browser can encode them) or WebM (VP9 or AV1 with Opus,
  offered where the browser can encode VP9 or AV1), 720p to 4K, 24/30/60 fps, whole song or
  a 15-second preview. Several formats can be rendered in one go.
- Undo/redo, autosave (layout in localStorage, files in IndexedDB), layout
  save/load as JSON, snapping guides, keyboard nudging.

- **Accounts** (optional): email and password, Google and Discord sign-in, linked
  accounts (YouTube channel and Discord name can fill your socials), defaults for
  new projects (artist name, website, socials, palette, font), and a project
  library that saves to your account or to this browser. Autosave detects edits
  from another tab or device instead of overwriting them.
- **Cloud rendering** (the `creator` plan; live billing is off): export on the server instead of the browser,
  using the same rendering code. See [docs/rendering.md](docs/rendering.md).

## Development

```sh
npm install
npm run dev        # editor on http://localhost:5173 (works without the API)
npm run build      # static site in dist/
npm test           # autosave regressions; API regressions also run when TEST_DATABASE_URL is set
```

For accounts and the API, see [docs/deploy.md](docs/deploy.md#local-development).
The API is documented in [docs/api.md](docs/api.md) and at `/docs` on a running server.

API regression tests require `npm --prefix server ci` and a disposable PostgreSQL
database whose name starts with `undertow_test`. Set `TEST_DATABASE_URL`, then run
`npm run test:integration`. Tests migrate and reset that database. Never point
them at a database containing user data. Gitea CI runs both suites and builds
against a separate PostgreSQL service.
With Docker available, `bash scripts/test-with-postgres.sh` creates and removes
that disposable database for you. Install the root and server dependencies first.

## Layout

| Path | Purpose |
|---|---|
| `src/types.ts`, `src/defaults.ts` | Project model, layer defaults, starter template |
| `src/templates.ts` | Template gallery layouts and how they adopt the current project's files |
| `src/audio/analysis.ts` | Decoding, FFT, per-frame levels, whole-song overview |
| `src/audio/lyrics.ts` | LRC/SRT/VTT parsing and LRC writing (`toLrc`) |
| `src/audio/lyricTiming.ts`, `src/ui/LyricTimingEditor.tsx` | Lyric timing editor: editing rules, dialog, waveform timeline |
| `src/audio/stems.ts`, `src/audio/unmix.ts`, `src/audio/stems.worker.ts`, `src/audio/stemSeparation.ts` | Stem sources per layer, the separation DSP, its worker, and model/stem caching |
| `src/audio/tempo.ts`, `src/audio/tempoDetection.ts` | Single-tempo beat grid (BPM and first beat) found in a worker after a song loads |
| `src/render/compositor.ts` | Draws a project frame; shared by preview and export |
| `src/render/layers.ts` | Drawing code for each layer type |
| `src/render/milkdrop.ts`, `src/render/presetPool.ts` | Butterchurn wrapper with deterministic preset changes; the preset pool and pick |
| `src/favourites.ts` | Starred Milkdrop presets, kept in this browser's localStorage |
| `src/effects.ts`, `src/render/postfx.ts` | Whole-frame effect settings and the WebGL2 pass that draws them |
| `src/render/particles.ts` | Particle fields computed from time, so export matches preview |
| `src/export/exportVideo.ts` | Offline frame-by-frame render and MP4/WebM encode (Mediabunny) |
| `src/export/clipReader.ts` | Exact frame decoding for video layers during export |
| `src/selftest.ts`, `selftest.html` | Browser export self-test (dev server only) |
| `src/brand.ts`, `src/ui/Brand.tsx`, `src/ui/AboutDialog.tsx` | Brand settings, logomark, social and Patreon links |
| `src/styles/`, `src/styleguide.tsx` | Design tokens, components and the style guide |
| `src/api/` | Typed API client, generated from the API's OpenAPI document (`npm run api:types`), and the auth client |
| `src/cloud/` | Account state, defaults, project library and autosave, media manifests and relinking |
| `server/` | The Undertow API: Hono, Better Auth, Postgres via Drizzle. See docs/api.md |
| `Dockerfile`, `deploy/` | One container serving the editor and API; production compose file |
| `server/src/worker/`, `Dockerfile.worker`, `render.html` | Cloud render worker (headless Chrome + ffmpeg) and the page it drives |
| `src/ui/` | Editor components |

## Branding and design system

`src/brand.ts` holds the site name, operator and contact address, tagline,
Patreon link, social links, terms and privacy links, and public URL. The header, About dialog, export dialog, page title, meta tags and
share previews all read from it. Links that still contain `PLACEHOLDER` show
with a dashed amber outline in development and are left out of production
builds.

The UI is styled only through CSS tokens. Glitch is the one design system;
`/styleguide.html` shows its tokens, components and icons. See
[docs/design-system.md](docs/design-system.md).

`terms.html` and `privacy.html` are plain HTML pages styled by
`src/styles/legal.css`. They read the site name, operator and contact address
from `src/brand.ts`. When the product changes what it stores, who processes it
or how billing works, update the page and its "Last updated" date in the same
change.

`npm run og-image` renders `public/og-glitch.png` from `scripts/og-image.html` with
headless Chrome. The card sets its text in the fonts bundled in
`scripts/og-fonts/` (Liberation Mono for the wordmark and labels, Public Sans
for the headline and detail lines), loaded with `@font-face`, so it does not
use the rendering machine's system fonts. Their licences sit beside them.

- macOS: `npm run og-image` uses Google Chrome at its default path.
- Linux: `CHROME=/usr/bin/chromium npm run og-image`, or point `CHROME` at
  another Chrome or Chromium binary.

Two runs on the same machine produce the same bytes. A different browser
version or operating system can still rasterize text slightly differently, so
open the PNG after rendering and check it before committing.

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

## Stem separation

The model is Open-Unmix UMX-HQ: four networks (drums, bass, other, vocals)
that estimate magnitude spectrograms. `src/audio/unmix.ts` turns the
estimates into ratio masks on the song's STFT (4096-point, hop 1024), so the
four stems add up to the mix, and runs the model 512 frames at a time with 64
frames of context on each side. The weights are MIT-licensed on the authors'
Zenodo record ([3370489](https://zenodo.org/records/3370489)); Demucs v4 and
UMX-L were ruled out because their weights aren't licensed for commercial use.
UMX-HQ was trained on MUSDB18-HQ, whose songs carry their own licences.

`scripts/stems/export-umxhq.py` downloads those weights, checks their hashes
and writes the int8 ONNX file the editor loads (35.9 MB; two runs produced the
same bytes):

```sh
uv run scripts/stems/export-umxhq.py public/models/umxhq-int8.onnx
```

`STEM_MODEL` in `src/audio/stems.ts` holds the file's URL, size and SHA-256;
the worker refuses a file that doesn't match. `public/models/` is gitignored,
so for local work run the script above. The editor caches the model with the
Cache API (`undertow-models-v1`). onnxruntime-web's WebAssembly runtime
(14.2 MB, 3.7 MB gzipped) is part of the build and loads only when someone
separates a song. The site isn't cross-origin isolated, so it runs on one
thread.

Measured 2026-11-10 in headless Chromium 158 on Kvant (Ryzen 9 9900X, busy:
load average 40–55), single-threaded WebAssembly, a 3:41 song. In the editor,
separating took 34 s (38 s including loading the model from a local server
and saving), and
the browser's memory grew by about 760 MB. A standalone benchmark of the same
song took 30 s with the int8 model and 35–46 s with the float32 one (142.5 MB).
WebGPU offered only SwiftShader on that machine, where the model ran slower
than on WebAssembly, so it isn't used. Phones are untested.

Each separated song stores about 0.7 MB per second of audio (four stereo
16-bit stems) in IndexedDB, one Blob per stem: Chrome rejects single records
over about 133 MB, which a four-minute song's stems exceed.

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
- Effects read the composited 2D canvas into a WebGL2 texture, run one
  fragment shader and draw the result back, so the exporter captures it.
  Grain is seeded from the frame time, so two exports decode to the same
  frames. Without WebGL2 the frame renders without effects and the console
  warns once. Measured 2026-11-10, Chromium 156 headless on Kvant (AMD Radeon
  iGPU through ANGLE GL; the machine was busy), 1080p30 export: about
  +3.3 ms/frame with all four effects on (10–13 ms/frame off, 13–16 on, 24–36%
  slower). On SwiftShader (no GPU) the same export went from ~11 to ~50 ms/frame.
- Milkdrop output isn't bit-identical between preview and export, because each
  one runs its own Butterchurn instance, but preset choices and timing match.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version of Undertow as a network service, the AGPL requires you to offer that
version's source code to its users.

The built-in fonts (Inter, Nunito Sans, Jost, Gelasio, Anton and Courier
Prime) are bundled from [Fontsource](https://fontsource.org) under the
[SIL Open Font License 1.1](https://openfontlicense.org). Each font's license
file is in its package under `node_modules/@fontsource*/`.

### Search and sharing

Production HTML includes the canonical Undertow URL, description, Open Graph and
Twitter card metadata, WebApplication structured data, and an initial description
that does not require JavaScript. The share image is `public/og-glitch.png`.
Regenerate it with `npm run og-image` after editing `scripts/og-image.html`.

The public editor is indexable. Account links, API routes, render pages and the
styleguide return `X-Robots-Tag: noindex, nofollow`. Unknown paths return 404.
The edge must not add a site-wide `noindex` header.

After deploying, run `python3 scripts/verify-seo.py` to check the live HTML,
share image, robots.txt, sitemap and page exclusions. Pass a base URL to check
another deployment. Search engines and social platforms control their own caches.
