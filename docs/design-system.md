# Design system

The editor UI is built from CSS custom properties (tokens). Five candidate systems exist while the look is being chosen. Neon is the default and the first draft. Studio, Analogue, Acid and Glitch are alternatives. Glitch is the latest direction: neubrutalist structure with a pastel version of the Neon palette and a colour-split glitch.

To compare them, run `npm run dev` and open `/styleguide.html`. The top section shows the same small editor in every system. "Show below" re-renders the full component catalogue in one system, and "Open editor" loads the real editor in it. The editor also accepts `?theme=glitch`, `?theme=studio`, `?theme=analogue`, `?theme=acid` or `?theme=neon`, and remembers the last choice in that browser.

## Files

| File | Contents |
|---|---|
| `src/styles/tokens.css` | Neon values for every token. The raw palette sits on `:root`. Semantic and derived tokens sit on `:root, [data-theme]` |
| `src/styles/themes.css` | Studio, Analogue, Acid and Glitch, each a `[data-theme="…"]` block that overrides semantic tokens, plus Glitch's animations |
| `src/styles/base.css` | Element defaults: type, links, focus ring, scrollbars |
| `src/styles/components.css` | Buttons, fields, sliders, tabs, menus, modals, progress bars, brand pieces |
| `src/styles/app.css` | Editor layout and editor-only parts |
| `src/theme.ts` | Theme list and the `?theme=` handling |
| `src/brand.ts` | Name, tagline, Patreon and social links, site URL |
| `src/ui/Brand.tsx` | Logomark, wordmark, social icons, Patreon button |

## Rules

1. Components use semantic tokens (`--surface-panel`, `--text-dim`, `--accent`). They never use raw palette names like `--ink-800` or literal colours. A theme then only needs to set semantic names.
2. A token computed from another token, such as `--accent-line: color-mix(in srgb, var(--accent) 50%, transparent)`, belongs in the `:root, [data-theme]` block. CSS resolves `var()` where the property is declared. Declaring it on themed elements too means a themed subtree recomputes it from its own `--accent`.
3. Text on a coloured fill uses `--text-on-accent`. On every theme this is a dark colour, because white on the bright accents fails WCAG AA.
4. `--text-faint` is below 4.5:1 on every theme. Use it only for disabled controls and decoration, never for text someone needs to read. Hints use `--text-dim`.
5. New UI goes into `/styleguide.html` so every system can be checked at once.
6. Animation must stop under `prefers-reduced-motion`. Glitch keeps its static colour split and drops the slicing, jitter and glitch-in.

## Screen sizes

The editor layout has four tiers, defined at the end of `src/styles/app.css`:

| Width | Layout |
|---|---|
| 1200px and up | Layers, stage and inspector in three columns. Everything in the header |
| 900 to 1199px | Narrower side panels. "Add files…" and Support move into the Project menu. Below 1024px the logo loses its name and the save status hides |
| Under 900px | One column: header, stage and transport, a Layers / Edit switch, then the chosen panel. Picking a layer opens Edit. The format tabs take a second header row |
| Under 600px | The header's second row holds undo, redo and the format tabs, shortened to ratios. Project becomes a ☰ menu. Dialogs fill the screen |

Phones held sideways (under 900px wide and under 560px tall) keep the stage and the panel side by side under a one-row header. On touch screens, the stage shows only the four corner handles, at 18px, and layer rows are taller.

Controls that exist in two places for different widths use `.wide-only` and `.narrow-only`. Check new header items at 390, 768, 1024 and 1280px wide.

## Token groups

| Group | Tokens |
|---|---|
| Surfaces | `--surface-app`, `-panel`, `-raised`, `-hover`, `-sunken`, `-overlay` |
| Lines | `--line`, `--line-strong`, `--line-hover`, `--track` |
| Text | `--text`, `--text-dim`, `--text-faint`, `--text-on-accent` |
| Accent | `--accent`, `--accent-hi`, `--accent-2`, `--accent-3`, `--accent-soft`, `--accent-line`, `--focus`, `--icon` |
| Status | `--warn`, `--danger`, `--success`, `--patreon` |
| Brand | `--brand-1` to `--brand-3` (logomark gradient), `--mark-ab-a` and `--mark-ab-b` (logomark colour-split copies, transparent unless set), `--gradient-brand`, `--font-brand`, `--brand-weight`, `--brand-case`, `--brand-tracking`, `--mark-radius` |
| Effects | `--glow-accent`, `--glow-focus`, `--glow-text`, `--glow-thumb`, `--glow-select`, `--glow-mark`, `--glow-patreon`, `--modal-ring`, `--stage-halo`, `--shadow-panel`, `--shadow-stage` |
| Type | `--font-ui`, `--font-display`, `--font-mono`, `--text-2xs` to `--text-2xl` (11 to 32 px), `--leading`, `--tracking-caps` |
| Space and size | `--space-1` to `--space-9` (2 to 32 px), `--control-h` (30 px), `--control-h-sm` (24 px), `--border-w` (1 px, 2 px in Glitch) |
| Radius | `--radius-sm`, `-md`, `-lg`, `-xl`, `-pill` |
| Motion | `--ease-out`, `--dur-fast` (120 ms), `--dur-med` (200 ms). Both drop to 0 with `prefers-reduced-motion` |

## The systems

| | Neon | Studio | Analogue | Acid | Glitch |
|---|---|---|---|---|---|
| Surfaces | Violet-black | Graphite | Warm charcoal | Pure black | Violet-dark, slightly lifted |
| Accent | Magenta, with violet and cyan | Blue | Amber, with VU green and red | Acid lime | Pastel pink, with sky and lilac |
| Primary button | Magenta to cyan gradient | Flat blue | Amber to red gradient | Flat lime, uppercase | Flat pink with ink outline and sky shadow, uppercase mono, jitters on hover |
| Effects | Glow on focus, selection, sliders and mark | None, focus ring only | Soft warm glow | Hard 4 px offset shadows | 2 px borders, hard lilac shadows, buttons that lift and press, sticker headings. Sky and pink split on the stage, wordmark and mark. Wordmark slices every 4.5 s. Dialogs glitch in |
| Corners | 4 to 16 px | 4 to 12 px | 3 to 10 px | Square | Square |
| Wordmark | Futura caps, wide tracking | System sans, sentence case | Serif (Iowan Old Style) | Monospace caps | Monospace caps with colour split |
| Body text on panel | 17.1:1 | 15.0:1 | 14.8:1 | 18.0:1 | 16.5:1 |
| Dim text on panel | 7.7:1 | 6.9:1 | 8.0:1 | 8.1:1 | 9.2:1 |
| Text on accent | 6.3:1 | 6.2:1 | 9.4:1 | 17.7:1 | 10.2:1 |

The fonts are system fonts, so nothing is downloaded. Futura, Avenir Next and Iowan Old Style ship with macOS. Other systems fall back to the next font in each stack.

## Picking one

When a system is chosen:

1. Move its values into `tokens.css` so it becomes the default.
2. Delete `themes.css`, `src/theme.ts` and the comparison section of the style guide, or keep the alternatives as user-selectable themes.
3. Update `public/favicon.svg` and `scripts/og-image.html` to the chosen brand colours, then run `npm run og-image`. Both currently use the Neon gradient, which Glitch drops.
