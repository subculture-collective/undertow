# Undertow

A layered music-visualizer video editor. Audio analysis, rendering and MP4
encoding happen in the browser, on the visitor's machine. Local exports keep
media on the device. Cloud exports upload the files needed by the render,
then delete the inputs when the job ends. Optional accounts store project layouts and defaults through
the Undertow API (`server/`), which is also usable by other apps with API keys.

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

- **Accounts** (optional): email and password, Google and Discord sign-in, linked
  accounts (YouTube channel and Discord name can fill your socials), defaults for
  new projects (artist name, website, socials, palette, font), and a project
  library that saves to your account or to this browser. Autosave detects edits
  from another tab or device instead of overwriting them.
- **Cloud rendering** (paid plans): export on the server instead of the browser,
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
| `src/audio/lyrics.ts` | LRC/SRT/VTT parsing |
| `src/render/compositor.ts` | Draws a project frame; shared by preview and export |
| `src/render/layers.ts` | Drawing code for each layer type |
| `src/render/milkdrop.ts` | Butterchurn wrapper with deterministic preset changes |
| `src/render/particles.ts` | Particle fields computed from time, so export matches preview |
| `src/export/exportVideo.ts` | Offline frame-by-frame render and MP4 encode (Mediabunny) |
| `src/export/clipReader.ts` | Exact frame decoding for video layers during export |
| `src/selftest.ts`, `selftest.html` | Browser export self-test (dev server only) |
| `src/brand.ts`, `src/ui/Brand.tsx`, `src/ui/AboutDialog.tsx` | Brand settings, logomark, social and Patreon links |
| `src/styles/`, `src/theme.ts`, `src/styleguide.tsx` | Design tokens, themes, components and the style guide (dev server only) |
| `src/api/` | Typed API client, generated from the API's OpenAPI document (`npm run api:types`), and the auth client |
| `src/cloud/` | Account state, defaults, project library and autosave, media manifests and relinking |
| `server/` | The Undertow API: Hono, Better Auth, Postgres via Drizzle. See docs/api.md |
| `Dockerfile`, `deploy/` | One container serving the editor and API; production compose file |
| `server/src/worker/`, `Dockerfile.worker`, `render.html` | Cloud render worker (headless Chrome + ffmpeg) and the page it drives |
| `src/ui/` | Editor components |

## Branding and design system

`src/brand.ts` holds the site name, tagline, Patreon link, social links and
public URL. The header, About dialog, export dialog, page title, meta tags and
share previews all read from it. Links that still contain `PLACEHOLDER` show
with a dashed amber outline in development and are left out of production
builds.

The UI is styled only through CSS tokens. Five candidate design systems (Neon,
Studio, Analogue, Acid, Glitch) can be compared at `/styleguide.html` on the dev
server, or tried in the editor with `?theme=glitch` and similar. See
[docs/design-system.md](docs/design-system.md).

`npm run og-image` renders `public/og.png` from `scripts/og-image.html` with
headless Chrome. Set `CHROME` to the browser binary if it isn't at the macOS
default path.

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
