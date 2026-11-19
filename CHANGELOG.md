# Changelog

Releases are named by revision letter. A new capital letter marks a big change;
lowercase letters after it mark minor tweaks.

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
