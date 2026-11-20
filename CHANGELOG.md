# Changelog

Releases are named by revision letter. A new capital letter marks a big change;
lowercase letters after it mark minor tweaks.

## Rev.B, 2026-11-20

- **Breaking:** format 1 hands are no longer read. Place their points again in the inspector.
- Hands are now format 2: a character places **sinks** (where a stroke touches down, lightest) and
  **pools** (where ink collects, heaviest) on the glyph; everything else is the base colour. This
  replaces the format 1 kinds (`mark`, `radial`, `dot`, `none`) and `start` / `end` rules.
- Shading is measured through the ink from the nearest sink, so it doesn't jump gaps between strokes.
  A pool wins where it overlaps a sink.
- `dir` on a sink or pool points it down one branch: it spreads only that way near the point and stops
  at the next crossing. A directed pool also washes ink back up its branch for `reach` em.
- `poolRandom: [min, max]` replaces the radial kind: a random few of a character's pools take ink.
- `poolRadius` / `poolAmount` replace `endRadius` / `endAmount` as a character's pool defaults.
- Characters without placed points are still guessed (dots, closed shapes, one stroke plus crossbar).
- Inspector: place, select and delete sinks and pools; set size, amount, reach and direction; place
  from guess; random pooling; format 1 hands are refused on load with a message.
- `hands/eravas-print-a.json` rewritten in format 2; the asterisk's pools point down their arms.

## Rev.A, 2026-11-19

Initial release.

- `nib.js`: fountain-pen ink renderer for handwriting fonts. Real, invisible text
  underneath; per-character sprite atlas; lazy rendering near the viewport;
  plain-text fallback and forced-colours support.
- Hands (stroke rules) and ink profiles as data: `hands/eravas-print-a.json`,
  `profiles/sailors-sailor.json`.
- Variant fonts: each letter picks one of several fonts at random.
- `inspector.html`: font inspector that proposes stroke rules, flags ambiguous
  glyphs and exports a hand as JSON.
- Font: eravas print a, Rev.A, as OTF and WOFF2 (see `fonts/eravas-print-a/FONTLOG.txt`).
- `tools/woff2.mjs`: OTF ⇄ WOFF2 converter for the example font.
