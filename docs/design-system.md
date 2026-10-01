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
| `src/brand.ts` | Name, tagline, Patreon and social links, site URL |
| `src/ui/Brand.tsx` | Logomark, wordmark, social icons, Patreon button |

## Rules

1. Components use semantic tokens (`--surface-panel`, `--text-dim`, `--accent`). They never use raw palette names like `--ink-800` or literal colours.
2. A token computed from another token, such as `--accent-line: color-mix(in srgb, var(--accent) 50%, transparent)`, belongs in the `:root` block.
3. Text on a coloured fill uses `--text-on-accent`. This is a dark colour, because white on the bright accents fails WCAG AA.
4. `--text-faint` is below 4.5:1 in Glitch. Use it only for disabled controls and decoration, never for text someone needs to read. Hints use `--text-dim`.
5. New UI goes into `/styleguide.html` so the component catalogue stays current.
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
| Brand | `--brand-1` to `--brand-3` (logomark gradient), `--mark-ab-a` and `--mark-ab-b` (logomark colour-split copies, sky and pink), `--gradient-brand`, `--font-brand`, `--brand-weight`, `--brand-case`, `--brand-tracking`, `--mark-radius` |
| Effects | `--glow-accent`, `--glow-focus`, `--glow-text`, `--glow-thumb`, `--glow-select`, `--glow-mark`, `--glow-patreon`, `--modal-ring`, `--stage-halo`, `--shadow-panel`, `--shadow-stage` |
| Type | `--font-ui`, `--font-display`, `--font-mono`, `--text-2xs` to `--text-2xl` (11 to 32 px), `--leading`, `--tracking-caps` |
| Space and size | `--space-1` to `--space-9` (2 to 32 px), `--control-h` (30 px), `--control-h-sm` (24 px), `--border-w` (1 px, 2 px in Glitch) |
| Radius | `--radius-sm`, `-md`, `-lg`, `-xl`, `-pill` |
| Motion | `--ease-out`, `--dur-fast` (120 ms), `--dur-med` (200 ms). Both drop to 0 with `prefers-reduced-motion` |
