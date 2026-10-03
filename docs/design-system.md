# Design system

The editor UI is built from CSS custom properties (tokens). Glitch is Undertow's only design system. Glitch uses neubrutalist structure with pastel pink, sky and lilac and a colour-split glitch.

To inspect the components, open `/styleguide.html` on the deployed site or local dev server. It renders the editor's component catalogue. Old theme links and saved theme choices no longer change the design.

## Files

| File | Contents |
|---|---|
| `src/styles/tokens.css` | Glitch palette, semantic and derived tokens on `:root` |
| `src/styles/glitch.css` | Glitch component treatments and animations |
| `src/styles/base.css` | Element defaults: type, links, focus ring, scrollbars |
| `src/styles/components.css` | Buttons, fields, sliders, tabs, menus, modals, progress bars, brand pieces |
| `src/styles/app.css` | Editor layout and editor-only parts |
| `src/styles/legal.css` | The terms and privacy pages (`terms.html`, `privacy.html`): long-form text, no JavaScript |
| `src/brand.ts` | Name, tagline, Patreon and social links, site URL |
| `src/ui/Brand.tsx` | Logomark, wordmark, social icons, Patreon button, terms and privacy links |
| `src/ui/icons.tsx` | Layer, file and control icons |
| `src/ui/Modal.tsx` | The dialog every modal uses |
| `src/ui/ask.tsx` | Confirm, rename and notice dialogs |

## Rules

1. Components use semantic tokens (`--surface-panel`, `--text-dim`, `--accent`). They never use raw palette names like `--ink-800` or literal colours.
2. A token computed from another token, such as `--accent-line: color-mix(in srgb, var(--accent) 50%, transparent)`, belongs in the `:root` block.
3. Text on a coloured fill uses `--text-on-accent`. This is a dark colour, because white on the bright accents fails WCAG AA.
4. `--text-faint` is below 4.5:1 in Glitch. Use it only for disabled controls and decoration, never for text someone needs to read. Hints use `--text-dim`.
5. New UI goes into `/styleguide.html` so the component catalogue stays current.
6. Animation must stop under `prefers-reduced-motion`. Glitch keeps its static colour split and drops the slicing, jitter and glitch-in.
7. Pink (`--accent`) marks actions: the primary button, slider thumbs and snapping guides. Sky (`--accent-2`, `--focus`) marks what is current: the active tab, the selected layer and its box on the stage, the chosen preset, and keyboard focus.
8. Each view has one `.primary` button. In the editor that is "Add your song" until the project has a song, then Export.
9. Corners are square. There are no radius tokens.
10. Fields and slider tracks are outlined with `--line-field`, which is at least 3:1 against every surface. `--line` and `--line-strong` are for dividers and for buttons, which have a fill and a label as well.
11. Dialogs use `Modal`, a native `<dialog>` opened with `showModal()`. It moves focus in, keeps it in, closes on Escape and returns focus to the control that opened it. Use `confirmAsk`, `promptAsk` and `noticeAsk` from `ask.tsx` in place of the browser's `confirm()`, `prompt()` and `alert()`.
12. Icons come from `icons.tsx`: one 24-unit grid and one square stroke. Add to that file; text glyphs such as ▶ or ✕ render differently in each system font. An icon-only button needs an `aria-label`.
13. The frame around the stage has no colour, so nothing tints the video being judged.

## Words

The editor's labels are the ones audio and video tools already use: Layers, Export, Resolution, Frame rate, Loop. Leave them short. The voice belongs in the page description, template descriptions, empty states, the first-run gallery, export notes and error messages.

1. Open with one line about the track, then give specifics: layer names, formats, numbers. "Give the track something to look at", then Milkdrop, spectrum, VU meters, LRC/SRT/VTT, 16:9, 9:16, 1:1, 720p to 4K.
2. Local export happens in the browser and uploads nothing. Say so where someone is about to render.
3. Codecs and render speed depend on the browser and the device. Never promise a fast render, or 4K on every machine. The exporter asks for H.264 and falls back to HEVC, VP9 or AV1.
4. Live billing is off. Nothing in the interface or on the page presents Creator, a price or cloud minutes as something to buy unless `GET /v1/billing` reports it enabled, and sandbox mode is labelled as a test.
5. An error says what happened and what to try next: "This browser cannot encode 3840x2160 video. Try a lower resolution or Chrome."
6. Patreon lines state that the editor is free either way. They don't ask how the export went.
7. Spelling follows the file you are in. The editor writes "colour"; the README writes "analyze".

The tagline in `src/brand.ts` is also set in the share image (`scripts/og-image.html`, `public/og-glitch.png`). Change both together with `npm run og-image`. The card uses the fonts in `scripts/og-fonts/`, not system fonts.

## Screen sizes

The editor layout has four tiers, defined at the end of `src/styles/app.css`:

| Width | Layout |
|---|---|
| 1200px and up | Layers, stage and inspector in three columns. Everything in the header |
| 900 to 1199px | Narrower side panels. "Add files…" and Support move into the Project menu. Below 1024px the logo loses its name and the save status hides |
| Under 900px | One column: header, stage and transport, a Layers / Edit switch, then the chosen panel. Picking a layer opens Edit. The format tabs take a second header row |
| Under 600px | The header's second row holds undo, redo and the format tabs, shortened to ratios. Project becomes a ☰ menu. Dialogs fill the screen |

Phones held sideways (under 900px wide and under 560px tall) keep the stage and the panel side by side under a one-row header. On touch screens (`pointer: coarse`), `--control-h` is 44px and `--control-h-sm` is 36px, layer-row buttons are 40px, and the stage shows only the four corner handles, at 18px.

Controls that exist in two places for different widths use `.wide-only` and `.narrow-only`. Check new header items at 390, 768, 1024 and 1280px wide.

## Token groups

| Group | Tokens |
|---|---|
| Surfaces | `--surface-app`, `-panel`, `-raised`, `-hover`, `-sunken`, `-overlay` |
| Lines | `--line`, `--line-strong`, `--line-field`, `--line-hover`, `--track` |
| Text | `--text`, `--text-dim`, `--text-faint`, `--text-on-accent` |
| Accent | `--accent`, `--accent-hi`, `--accent-2`, `--accent-3`, `--accent-soft`, `--accent-line`, `--focus`, `--icon` |
| Status | `--warn`, `--danger`, `--success`, `--patreon` |
| Brand | `--mark-ab-a` and `--mark-ab-b` (logomark colour-split copies, sky and pink), `--font-brand`, `--brand-weight`, `--brand-case`, `--brand-tracking` |
| Hard shadows | `--shadow-lift`, `--shadow-focus`, `--shadow-thumb`, `--shadow-panel`, `--shadow-stage`, `--modal-ring` |
| Colour split | `--split-text`, `--split-select` |
| Type | `--font-ui`, `--font-display`, `--font-mono`, `--text-2xs` to `--text-2xl` (11 to 32 px), `--leading`, `--tracking-caps` |
| Space and size | `--space-1` to `--space-9` (2 to 32 px), `--control-h` (30 px, 44 px on touch), `--control-h-sm` (24 px, 36 px on touch), `--border-w` (2 px) |
| Motion | `--ease-out`, `--dur-fast` (120 ms), `--dur-med` (200 ms). Both drop to 0 with `prefers-reduced-motion` |
