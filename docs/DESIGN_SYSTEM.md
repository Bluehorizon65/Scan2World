# Design system

Direction: a precise instrument for surveying rooms — graphite surfaces, one brass accent borrowed from
surveying instruments, measured typography. Boldness is spent in one place: the landing hero's stage scrubber
over a real reconstruction. Everything else is quiet.

## Colour (tokens in `apps/web/src/styles.css`)
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#16181B` | page and viewport background |
| `panel` | `#1D2024` | panels, side bars |
| `raised` | `#272B30` | selected rows, secondary buttons |
| `line` | `#353A41` | borders, dividers |
| `ink` / `muted` / `faint` | `#E6E3DC` / `#9AA0A6` / `#6B7178` | text hierarchy |
| `brass` | `#C9A45C` | the only accent: primary actions, focus, active stage |
| `collision` / `walkable` | `#5FB3C9` / `#86B97A` | viewport overlays only (and "done" states) |
| `danger` / `warning` | `#E0705A` / `#D9B25A` | errors / cautions |

(The colour token is named `canvas`, not `base`: in Tailwind 4 a `base` colour collides with the `text-base`
font-size utility.)

## Type
One family, **Archivo** (variable width): `font-display` (118% width, 640 weight) for the landing headline,
`font-heading` (108%) for headings, normal width for UI. Tabular figures everywhere (`font-variant-numeric`).
Scale (minor third from 15 px): 12 · 13 · 15 · 18 · 21.6 · 26 · 36 px, display `clamp(2.4rem, 5.2vw, 4.4rem)`.
No all-caps labels, no monospace data labels.

## Shape & layout
Radii follow hierarchy: controls 4 px, panels 8 px, viewport 0. Lists and tables instead of card grids.
Workspaces (studio, game map) fill the viewport with internal scrolling; content pages max 72–80 rem, left-aligned.
Numbered markers only where content is a real sequence (pipeline rail, job stages, landing steps).

## Components (`apps/web/src/components/ui.tsx`)
Button (primary/secondary/ghost/danger), Input, Field (label + error/hint), Notice (info/warning/error),
StatusBadge (job states, pulsing dot while live), Panel, Stat, ConfirmDialog (Radix), Spinner.

## Interaction & accessibility
Visible brass focus ring; Radix primitives for dialog, tooltip, toggle groups, switch, slider; every icon button
has a label; reduced motion disables the hero auto-rotate and crossfades. Errors say what happened and what to
do. Progress bars appear only for measured progress — otherwise stage and elapsed time.
