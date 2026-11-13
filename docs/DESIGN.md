# Design system

Neo-Brutalist, engineering-grade. The app is dark-only.
Every colour, size and spacing value comes from tokens in `src/index.css`. Do not
hardcode hex values in components or CSS: the SVG diagrams
depend on tokens.

## The one rule

**Lime means "1, active, valid, or the single primary action".** Never use it as
decoration. Wires, gates and bits that are `1` are lime; everything else is neutral.

## Tokens (see `src/index.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--canvas` `--surface` `--raised` `--inset` |
| Text | `--text-1` `--text-2` `--text-3` |
| Lines | `--line` (hairline) `--line-strong` |
| Signal | `--signal` (fills) `--signal-ink` (text-safe lime) `--on-signal` `--signal-dim` |
| Logic state | `--logic-1` `--logic-0` `--logic-x` |
| Status | `--warn` `--error` (`--accent-rose`) |
| Type | `--font-display` `--font-mono`, `--fs-*`, `--track-*` |
| Space | `--space-1` … `--space-7` (4px scale), `--gutter`, `--section-gap` |
| Motion | `--dur-*`, `--ease-snap` (reduced-motion is honoured) |

Corners are square. Borders are 1px hairlines. Mono is for code, formulas, labels.

## Primitives (reuse these, do not add new ones)

| Primitive | Class | Use |
|---|---|---|
| Primary button | `.btn-primary` | One per view (Export, Pulse clock, Open workbench) |
| Secondary button | `.btn-secondary` | Everything else |
| Segmented control | `.wb-seg` (`--sm`) | Switching a view or mode |
| Chip | `.dp-chip` | Picking one item from a list |
| Bit toggle | `.dp-bit` | Input/output bits (lime when 1) |
| Panel | `.dp-panel` (alias `.card`) | A bordered surface |
| Stat | `.dp-stats li` | Label + number |
| Page head | `<PageHead />` | Every non-workbench page |
| Schematic | `<SchematicView />` | Any gate-level circuit |

## Naming

- `wb-` workbench (the scrolling home page) · `dp-` deep-dive pages · `sch-`
  schematic · `ff-` flip-flop simulator · `shell-` app chrome.
- Legacy names in `App.css` (`.card`, `.btn-*`, `.data-table`) are restyled in
  `src/ui/deep/deep.css`. Prefer the primitives above in new code.

## Content

Labels are mono and uppercase through CSS (write them in sentence case in JSX).
Buttons say what happens ("Pulse clock", "Export project"). Empty states say what
to do next and link to the workbench.

## Accessibility

Text contrast is at least 4.5:1 (lime on obsidian is 16:1; in Paper the text lime
is `--signal-ink`, a dark green). Every control has a visible `:focus-visible`
ring. Touch targets are at least 36px (40px for primary controls). Colour is never
the only signal: bits also show their digit.
