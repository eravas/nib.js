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
| `inspector.html` | Font inspector: proposes ink rules for a font and exports a hand. |
| `hands/` | Hands (where strokes start and ink pools) as JSON. |
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

A hand describes how a font's letters were written, as points on each glyph. **Sinks** are where a
stroke touches down, so the ink is lightest there. **Pools** are where ink collects, so it is heaviest
there. Everything else is the base colour. You place points in the inspector; any character without
them is guessed from the glyph's shape.

```json
{
  "format": 2,
  "name": "eravas print a",
  "refSize": 92,
  "closedPoolChance": 0.5,
  "chars": {
    ",": { "poolRadius": 1.7, "poolAmount": 1 },
    "e": { "sinks": [{ "x": 0.213, "y": -0.193 }], "pools": [{ "x": 0.207, "y": -0.033, "radius": 1.9 }] },
    "*": {
      "poolRandom": [1, 3],
      "sinks": [{ "x": 0.217, "y": -0.6 }, { "x": 0.313, "y": -0.613 }],
      "pools": [{ "x": 0.23, "y": -0.363, "dir": 249 }, { "x": 0.143, "y": -0.397, "dir": 304 }]
    }
  }
}
```

- `refSize`: the size in px the shading is calibrated at. Smaller text pools over more of each stroke.
- `closedPoolChance`: how often guessed closed shapes, such as `o`, pool where they start and end.
- `chars`: one entry per character, all fields optional:
  - `sinks: [{ x, y, radius?, dir? }]` and `pools: [{ x, y, radius?, amount?, dir?, reach? }]`.
    Points are in em from the pen origin (y down) and snap to the glyph's centreline. Lightening and
    pooling fade with distance measured through the ink, so they don't jump gaps between strokes.
    Where a pool overlaps a sink, the pool wins.
  - `radius` scales a sink's light run-in (1 is standard) or sets a pool's size. `amount` is a pool's
    weight.
  - `dir` points a sink or pool down one branch, in degrees (0 is right, 90 is down). Near the point
    it spreads only that way, and it stops at the next crossing. A directed pool also washes ink back
    up that branch for `reach` em (default 0.3), which is how one arm of the asterisk takes heavy ink.
  - `poolRadius` and `poolAmount`: defaults for the character's pools, placed or guessed.
  - `poolRandom: [min, max]`: only that many of the character's pools, picked at random each time,
    take ink. The asterisk uses this.
  - `crossbar: false`: turns off crossbar pooling in guesses.

Parts of a glyph without placed points are guessed: dots, such as the dots on i and j, pool whole;
closed shapes start and end at the top; anything else is one stroke from its topmost free end to its
lowest, and extra free ends are treated as a crossbar.

## Font inspector

Open `inspector.html`, then load a font. Each glyph shows its centreline, its placed sinks and pools,
and the guessed start and end of anything else. Guesses that are likely wrong are flagged:

- more than two free ends
- closed shapes
- ends at the same height
- several separate strokes

Select a glyph, choose `[sink]` or `[pool]`, and click the glyph to place one. Click a placed point to
select it, then set its size, amount, reach and direction (`[set direction]`, then click where it
should point). `[place from guess]` turns the current guess into points you can edit. You can also set
the character's pool defaults and turn on random pooling. The ink previews and test line update as you
go. Copy the hand as JSON when you're done.

## Profiles

A profile is an ink's colour:

- `lut`: rows of `[density, OD red, OD green, OD blue]` for thick films, the swatch curve.
- `rim`: the halo colour's optical density per channel.
- `navy`: the channel ratio thin strokes darken towards.

Optical density is how strongly the ink absorbs each colour channel; higher is darker.

## How it works

1. **Analysis.** Each glyph is rasterised with slight hand jitter and thinned to a one-pixel
   centreline (Zhang–Suen). Free ends and crossings come from that centreline. The hand's sinks and
   pools snap to it; anything without them is guessed from the free ends.
2. **Simulation.** Ink spreads along the stroke but not out of it. The stroke darkens with distance
   (through the ink) from the nearest sink, pools dry with tide lines and edge darkening, and paper tooth and word-to-word flow
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
  [Mountain of Ink]([https://mountainofink.com](https://mountainofink.com/blog/sailors-sailor).
- Centreline thinning: T. Y. Zhang and C. Y. Suen, "A fast parallel algorithm for thinning digital
  patterns", Communications of the ACM, 1984.
- Made with Claude Opus 5.5

## License

- Code: MIT, see [`LICENSE`](LICENSE).
- Font: SIL Open Font License 1.1, with Reserved Font Name "eravas print". See
  [`fonts/eravas-print-a/OFL.txt`](fonts/eravas-print-a/OFL.txt).

