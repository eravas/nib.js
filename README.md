# nib.js

fountain pen for the web

[Example page](https://eravas.github.io/nib.js/examples/) · [Font inspector](https://eravas.github.io/nib.js/inspector.html)

nib.js renders handwriting fonts as if they were written with a fountain pen: ink that shades along
each stroke, pools where the nib lifts, dries with tide lines and a halo, and varies from word to
word. The text on the page stays real text. The ink is painted underneath an invisible copy of it,
so selection, find-in-page, links, copy and paste and screen readers all keep working.

## Quick start

```html
<style>
  @font-face {
    font-family: "eravas print a";
    src: url("fonts/eravas-print-a/eravas-print-a.woff2") format("woff2"),
         url("fonts/eravas-print-a/eravas-print-a.otf") format("opentype");
  }
  .pamphlet p { font-family: "eravas print a"; }
</style>

<script type="module">
  import { createInk, ERAVAS_PRINT_A, SAILORS_SAILOR } from "./nib.js";

  const ink = createInk({ font: '"eravas print a"', hand: ERAVAS_PRINT_A, profile: SAILORS_SAILOR });
  ink.attach(document.querySelectorAll(".pamphlet p"));
</script>
```

Elements you attach must be set in the handwriting font. Text shows as plain text until its ink is
ready, then the ink fades in.

## What's in the repo

| Path | What it is |
| --- | --- |
| `nib.js` | The renderer. One ES module, no dependencies, no build step. |
| `inspector.html` | Font inspector: proposes stroke rules for a font and exports a hand. |
| `hands/` | Hands (stroke rules) as JSON. |
| `profiles/` | Ink colour profiles as JSON. |
| `fonts/eravas-print-a/` | The example font (WOFF2 for the web, OTF to install), its license and its FONTLOG. |
| `examples/index.html` | Example page. |
| `tools/check-data.mjs` | Checks the JSON files match the defaults built into `nib.js`. |
| `tools/woff2.mjs` | Converts the example font between OTF and WOFF2 (Node, no dependencies). |

## API

### `createInk(options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `font` | `'"eravas print a"'` | Font family (CSS syntax) when using one font. |
| `hand` | `ERAVAS_PRINT_A` | Stroke rules for `font`. |
| `fonts` | | Several fonts: `[{ family, hand, weight }]`. The first lays out the text; every letter picks one at random. |
| `profile` | `SAILORS_SAILOR` | Ink colour profile. |
| `flow` | `0.55` | 0 is a dry nib, 1 a wet one. |
| `halo` | `true` | Red-violet rims on heavy pools. |
| `variants` | `2` (`1` with several fonts) | Jitter variants per character. |
| `uniqueUnder` | `40` | Elements with fewer letters than this (titles) get a unique sprite per letter. |
| `skip` | `"code, pre, kbd, samp, .no-ink"` | Elements inside attached elements that stay plain text. |
| `salt` | `0` | Change to ink everything differently. |
| `rootMargin` | `"100% 0px"` | How close to the viewport an element must be to be inked. |
| `maxDpr` | `2` | Highest pixel ratio sprites are built at. |

It returns an object with:

- `attach(elements)` and `detach(elements)`: start or stop inking an element, a NodeList or an array.
- `setEnabled(on)`: `false` shows plain text everywhere, `true` inks again.
- `refresh(options)`: change any option above and re-ink.
- `idle()`: a promise that resolves when queued inking has finished.
- `enabled`, `stats`: current state, and sprite and timing counters.

### Other exports

- `analyseGlyph({ ch, family, hand, sizePx })`: a glyph's mask, centreline, stroke plan and flags (used by the inspector).
- `inkGlyph({ ch, family, hand, profile, sizePx, seed, tier })`: one inked glyph as a canvas.
- `ERAVAS_PRINT_A`, `SAILORS_SAILOR`: the built-in hand and profile, the same data as the JSON files.

To use a JSON hand or profile, load it and pass the object:

```js
const hand = await (await fetch("hands/my-font.json")).json();
```

## Hands

A hand describes how a font's letters were written: which way each stroke runs and where ink pools.
nib.js finds the strokes from each glyph's shape; the hand settles what the shape can't tell it.

```json
{
  "format": 1,
  "name": "eravas print a",
  "refSize": 92,
  "closedPoolChance": 0.5,
  "defaults": { "kind": "stroke" },
  "chars": {
    ",": { "kind": "mark" },
    "g": { "start": "skel:top", "end": "junction:right", "endRadius": 1.9, "endAmount": 1, "crossbar": false },
    "*": { "kind": "radial", "pooled": [1, 3] }
  }
}
```

- `refSize`: the size in px the shading is calibrated at. Smaller text pools over more of each stroke.
- `closedPoolChance`: how often closed shapes such as `o` pool where they start and end.
- `kind`:
  - `stroke`: one stroke from start to end, pooling at the end. Extra free ends are a crossbar.
  - `mark`: starts at the top, pools at the bottom.
  - `radial`: strokes run through a centre, like an asterisk.
  - `dot`: the whole shape pools. `none`: no pools.
- `start`, `end`, and `pools[].at` take a point:
  - `"top"`, `"bottom"`, `"left"` or `"right"`: the most extreme free stroke end in that direction.
  - `"junction:<dir>"` or `"skel:<dir>"`: the most extreme crossing or centreline point.
  - `{ "x": 0.21, "y": -0.04 }`: a point in em from the pen origin (y down), snapped to the nearest centreline.
- `endRadius` and `endAmount`: size and weight of the end pool. `crossbar: false` turns off crossbar pooling.
- `pooled`: for `radial`, the minimum and maximum number of strokes that pool.

Dots, such as the dots on i and j, always pool whole unless the rule is `none`. Characters without a rule use `defaults`.

## Font inspector

Open `inspector.html`, then load a font. Each glyph shows its centreline with the proposed start and
end. Glyphs where the guess is uncertain are flagged:

- more than two free ends
- closed shapes
- ends at the same height
- several separate strokes

Select a glyph to set its kind, click to place its start, end or extra pools, and watch the ink
previews and the test line update. Copy the hand as JSON when you're done.

## Profiles

A profile is an ink's colour:

- `lut`: rows of `[density, OD red, OD green, OD blue]` for thick films, the swatch curve.
- `rim`: the halo colour's optical density per channel.
- `navy`: the channel ratio thin strokes darken towards.

Optical density is how strongly the ink absorbs each colour channel; higher is darker.

## How it works

1. **Analysis.** Each glyph is rasterised with slight hand jitter and thinned to a one-pixel
   centreline (Zhang–Suen). Free ends and crossings come from that centreline. The hand turns them
   into strokes, start points and pools.
2. **Simulation.** Ink spreads along the stroke but not out of it. The stroke darkens with distance
   from its start, pools dry with tide lines and edge darkening, and paper tooth and word-to-word flow
   vary the result.
3. **Colour.** Density maps through the profile: thin strokes along the navy line curve, pools along
   the violet swatch curve.
4. **Atlas.** Each character is inked once per font, size, pixel ratio and jitter variant, in three
   word-flow tiers, then reused.
5. **Layout and compositing.** The browser lays out the text. nib.js reads word positions with Range
   rects and draws sprites on a canvas blended with `mix-blend-mode: multiply`, so the ink darkens the
   paper behind it.

## Accessibility

- The text is real text in the page. The ink canvas is hidden from assistive technology.
- Before inking, without JavaScript, or with `setEnabled(false)`, the text is plain.
- In forced-colours mode (Windows high contrast) the ink is hidden and the text is shown.
- With `prefers-reduced-motion`, the ink appears without a fade.
- Link underlines and `skip` elements stay visible over the ink.

## Performance

Measured on the example page in headless Chrome:

- About 0.6 to 0.9 s to ink the whole page on a desktop.
- About 1.9 s for the first two screens with the CPU throttled 4×, as a stand-in for a mid-range phone.
- Once the cache is warm, each further paragraph takes roughly 10 to 20 ms on a desktop and about
  100 ms with the CPU throttled.

## Limitations

- Ink needs a light background; it darkens whatever is behind it.
- Connected scripts, high-contrast calligraphic fonts and outline fonts don't suit the method.
- Variant fonts should share roughly the same letter widths, since the first font sets the spacing.
- Requires `fontBoundingBoxAscent`, `IntersectionObserver`, `ResizeObserver` and `mix-blend-mode`.
  `scheduler.yield` is used when available.

## Credits

- The example font was built with [Ductus](https://ductus.sorenblank.com).
- Ink pooling and shading profiles developed from measurements taken from writing samples from
  [Mountain of Ink](https://mountainofink.com).
- Centreline thinning: T. Y. Zhang and C. Y. Suen, "A fast parallel algorithm for thinning digital
  patterns", Communications of the ACM, 1984.

## License

- Code: MIT, see [`LICENSE`](LICENSE).
- Font: SIL Open Font License 1.1, with Reserved Font Name "eravas print". See
  [`fonts/eravas-print-a/OFL.txt`](fonts/eravas-print-a/OFL.txt).

