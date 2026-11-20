/*
 * nib.js — fountain pen for the web
 *
 * Fountain-pen ink rendering for handwriting fonts.
 *
 * Paints simulated ink (shading, end pools, tide lines, halo) under real, invisible text, so the
 * page keeps selection, find-in-page, links, copy/paste and screen-reader text. Plain text is the
 * default state: ink is added only once it has been rendered, and is removed in forced-colours
 * mode and whenever it is switched off.
 *
 *   import { createInk, ERAVAS_PRINT_A, SAILORS_SAILOR } from "./nib.js";
 *   const ink = createInk({
 *     fonts: [                                            // first = layout font (set it in CSS)
 *       { family: '"eravas print a"',   hand: ERAVAS_PRINT_A },
 *       { family: '"eravas print b"', hand: myHandB, weight: 1 },   // variants, picked per letter
 *     ],
 *     profile: SAILORS_SAILOR,
 *   });
 *   ink.attach(document.querySelectorAll(".pamphlet h1, .pamphlet p, .note"));
 *   ink.setEnabled(false);   // plain text everywhere; ink.setEnabled(true) to restore
 *
 * The engine knows nothing about a particular font: it rasterises each glyph and finds its strokes
 * from the shape. What is personal lives in a *hand* (plain data, see ERAVAS_PRINT_A): where
 * strokes start, where ink pools, and the size calibration. Make one for a new font with the font
 * inspector, which proposes points, flags ambiguous glyphs and exports the hand as JSON.
 *
 * Variant fonts: every letter picks one of the fonts at random (by weight, only fonts that have the
 * character). Layout and spacing come from the first font; a variant glyph is centred in that
 * font's advance, so variants should share roughly the same widths and metrics.
 *
 * How it works
 *   1. Atlas. Each character is inked once per (font, size, pixel ratio, jitter variant) into a
 *      small sprite and shaded in three word-flow tiers. Sprites are cached, so a long post costs
 *      about one set per distinct character, not one simulation per letter.
 *   2. Layout. The browser lays out the text; nib.js reads word positions with Range rects and
 *      places each sprite at its character's pen position.
 *   3. Compositing. Sprites hold transmittance (paper = white) and the ink canvas is blended with
 *      mix-blend-mode: multiply, so ink darkens the real paper and overlapping strokes darken
 *      each other.
 *   4. Budget. Elements are inked only near the viewport, re-inked on resize and zoom, and freed
 *      when far away; sprite building yields to the main thread every ~8 ms. Large glyphs are
 *      simulated at reduced resolution.
 *
 * Randomness is seeded from each element's text, so the same text always inks the same way.
 */

/** Ink rules for "eravas print a" (hand format 2). Keys of `chars` are characters; see planStrokes for
 *  the fields. Characters without placed points are guessed: one stroke from the topmost free end to
 *  the lowest, pooling at the end. Directions are degrees, 0 = right, 90 = down. */
export const ERAVAS_PRINT_A = {
  format: 2,
  name: "eravas print a",
  refSize: 92,               // px size the shading was calibrated at; smaller text pools more of each stroke
  closedPoolChance: 0.5,     // closed shapes (o) pool at their start/end half the time
  chars: {
    // short marks: guessed top to bottom, with a full pool at the bottom
    ",": { poolRadius: 1.7, poolAmount: 1 }, ";": { poolRadius: 1.7, poolAmount: 1 }, "'": { poolRadius: 1.7, poolAmount: 1 },
    '"': { poolRadius: 1.7, poolAmount: 1 }, "`": { poolRadius: 1.7, poolAmount: 1 },
    "\u2018": { poolRadius: 1.7, poolAmount: 1 }, "\u2019": { poolRadius: 1.7, poolAmount: 1 },
    "\u201C": { poolRadius: 1.7, poolAmount: 1 }, "\u201D": { poolRadius: 1.7, poolAmount: 1 },
    // e: starts in the loop, pools on the tail
    "e": { sinks: [{ x: 0.213, y: -0.193 }], pools: [{ x: 0.207, y: -0.033, radius: 1.9, amount: 1 }] },
    // g: starts in the upper loop, pools where the lower loop closes into the link
    "g": { sinks: [{ x: 0.212, y: -0.287 }], pools: [{ x: 0.347, y: -0.07, radius: 1.9, amount: 1 }] },
    // asterisk: four strokes through the centre; 1–3 of their pools, picked at random, take heavy ink
    // and wash back up their arm
    "*": {
      poolRandom: [1, 3],
      sinks: [{ x: 0.217, y: -0.6 }, { x: 0.313, y: -0.613 }, { x: 0.38, y: -0.51 }, { x: 0.097, y: -0.57 }],
      pools: [
        { x: 0.23, y: -0.363, dir: 249 },    // top → bottom
        { x: 0.143, y: -0.397, dir: 304 },   // upper right → lower left
        { x: 0.09, y: -0.473, dir: 3 },      // right → left
        { x: 0.22, y: -0.5, dir: 210 },      // short upper-left arm, ending in the centre
      ],
    },
  },
};

/** Sailor's Sailor (discontinued Sailor blue → violet). Colour curves measured from scans:
 *  lut = [density, OD red, OD green, OD blue] (thick-film swatch curve), rim = halo colour OD,
 *  navy = channel ratio that thin strokes darken towards. */
export const SAILORS_SAILOR = {"format": 1, "name": "Sailor's Sailor", "lut": [[0.0, 0, 0, 0], [0.11, 0.196, 0.113, 0.022], [0.224, 0.417, 0.182, 0.06], [0.301, 0.534, 0.273, 0.089], [0.338, 0.586, 0.319, 0.105], [0.363, 0.615, 0.354, 0.118], [0.382, 0.63, 0.388, 0.128], [0.399, 0.645, 0.415, 0.138], [0.415, 0.653, 0.444, 0.15], [0.431, 0.645, 0.491, 0.163], [0.445, 0.593, 0.551, 0.176], [0.459, 0.586, 0.591, 0.187], [0.473, 0.593, 0.62, 0.196], [0.487, 0.607, 0.636, 0.204], [0.503, 0.63, 0.66, 0.212], [0.52, 0.645, 0.685, 0.221], [0.542, 0.678, 0.712, 0.23], [0.583, 0.732, 0.771, 0.252]], "rim": [0.445, 0.67, 0.308], "navy": [1, 0.62, 0.25]};

/* ---------- utilities ---------- */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// separable box blur (in place), radius r
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

// smooth value noise in [0,1]
function noise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / cell, y0 = gy | 0, fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = x / cell, x0 = gx | 0, fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}


/* ---------- Zhang–Suen thinning → centreline ---------- */
function skeleton(B, w, h) {
  const S = Uint8Array.from(B), del = new Int32Array(w * h);
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      let nd = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x; if (!S[i]) continue;
        // neighbours P2..P9, clockwise from north
        const p2 = S[i - w], p3 = S[i - w + 1], p4 = S[i + 1], p5 = S[i + w + 1],
              p6 = S[i + w], p7 = S[i + w - 1], p8 = S[i - 1], p9 = S[i - w - 1];
        const nb = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (nb < 2 || nb > 6) continue;
        const t = (!p2 & p3) + (!p3 & p4) + (!p4 & p5) + (!p5 & p6) + (!p6 & p7) + (!p7 & p8) + (!p8 & p9) + (!p9 & p2);
        if (t !== 1) continue;
        if (pass === 0 ? (p2 & p4 & p6) | (p4 & p6 & p8) : (p2 & p4 & p8) | (p2 & p6 & p8)) continue;
        del[nd++] = i;
      }
      for (let k = 0; k < nd; k++) S[del[k]] = 0;
      if (nd) changed = true;
    }
  }
  return S;
}

/* ---------- stroke planning: where strokes start and where ink pools ----------
   Driven by a hand (see ERAVAS_PRINT_A). A character's entry may place points, each { x, y } in em
   from the pen origin (y down), snapped to the glyph's centreline:
       sinks: [{ x, y, radius?, dir? }]                  where a stroke touches down: lightest
       pools: [{ x, y, radius?, amount?, dir?, reach? }]  where ink collects: heaviest
   Everything else is the base colour. Distances are measured through the ink, not across gaps. A pool
   wins where it overlaps a sink. radius scales a sink's light run-in or sets a pool's size (in stroke
   half-widths); amount is a pool's ink. dir (degrees, 0 = right, 90 = down) points a sink or pool down
   one branch: its spread is held to that direction near the point and stops at the next crossing, and
   a directed pool also washes ink back up that branch for `reach` em (default 0.3).
   Other entry fields: poolRadius / poolAmount (defaults for the character's pools, placed or guessed),
   poolRandom: [min, max] (only that many of the pools, picked at random, take ink), crossbar: false.
   Blobs of ink no placed point touches are guessed:
   - compact blobs (dots) are one whole pool
   - closed shapes (o) start and end at the top
   - otherwise one stroke from the topmost free end to the lowest; extra free ends are a crossbar  */
function components(B, w, h) {
  const L = new Int32Array(w * h).fill(-1), comps = [], stack = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!B[s0] || L[s0] >= 0) continue;
    const c = { id: comps.length, area: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, skel: [], ends: [], juncs: [] };
    L[s0] = c.id; stack.push(s0);
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      c.area++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (B[j] && L[j] < 0) { L[j] = c.id; stack.push(j); }
      }
    }
    c.cx = c.sx / c.area; c.cy = c.sy / c.area;
    comps.push(c);
  }
  return { L, comps };
}

// Zhang–Suen leaves short spurs near junctions; drop free ends that sit within a stroke width of a junction
function pruneSpurs(c, half) {
  const lim = (half * 2.2) ** 2;
  c.ends = c.ends.filter(([x, y]) => !c.juncs.some(([jx, jy]) => (x - jx) ** 2 + (y - jy) ** 2 < lim) || c.ends.length <= 2);
}

const DIRS = {
  top: (a, b) => b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]),
  bottom: (a, b) => b[1] > a[1],
  left: (a, b) => b[0] < a[0],
  right: (a, b) => b[0] > a[0],
};
const extreme = (pts, dir) => pts.length ? pts.reduce((a, b) => (DIRS[dir](a, b) ? b : a)) : null;

function isDot(c, half) {
  const span = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
  return span <= half * 3.6 || c.skel.length <= half * 2.2;
}

// two set neighbours that touch each other (a diagonal and an orthogonal one) still make a stroke end
function adjacent(p) { for (let k = 0; k < 8; k++) if (p[k] && p[(k + 1) % 8]) return true; return false; }

// nearest centreline pixel to an em point, across all blobs (null if none within 0.2 em)
function snapPoint(spec, comps, origin) {
  const tx = origin.x + spec.x * origin.em, ty = origin.y + spec.y * origin.em;
  let best = null, comp = null, bd = Infinity;
  for (const c of comps) for (const p of c.skel) {
    const d = (p[0] - tx) ** 2 + (p[1] - ty) ** 2; if (d < bd) { bd = d; best = p; comp = c; }
  }
  return bd <= (0.2 * origin.em) ** 2 ? { p: best, comp } : null;
}

// a direction in degrees (0 = right, 90 = down) → unit vector
const unit = deg => deg === undefined || deg === null ? null : [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];

function planStrokes(B, S, w, h, half, flow, opts, rand) {
  const { L, comps } = components(B, w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!S[i]) continue;
    const c = comps[L[i]]; if (!c) continue;
    // crossing number: how many separate branches leave this pixel (staircase corners count once, not as junctions)
    const p = [S[i - w], S[i - w + 1], S[i + 1], S[i + w + 1], S[i + w], S[i + w - 1], S[i - 1], S[i - w - 1]];
    let n = 0, cn = 0; for (let k = 0; k < 8; k++) { n += p[k]; cn += (!p[k] && p[(k + 1) % 8]) ? 1 : 0; }
    c.skel.push([x, y]);
    if (n === 1 || (cn === 1 && n === 2 && (p[0] + p[2] + p[4] + p[6]) === 1 && (p[1] + p[3] + p[5] + p[7]) === 1 && adjacent(p))) c.ends.push([x, y]);
    else if (cn >= 3) c.juncs.push([x, y]);
  }
  for (const c of comps) if (!c.skel.length) c.skel.push([Math.round(c.cx), Math.round(c.cy)]);
  const hand = opts.hand, rule = (hand.chars || {})[opts.ch] || {};
  const wet = 0.5 + flow, heavy = () => (0.75 + 0.35 * rand()) * wet;
  const R = k => Math.max(2, Math.round(half * k * opts.poolScale));
  const origin = opts.origin, stamps = [], sinks = [], fields = [], points = [], strokes = [], covered = new Set();
  const pool = (p, r, amt, why) => { if (p) stamps.push({ x: p[0], y: p[1], r, amt, why }); };
  const poolR = () => rule.poolRadius ?? (1.4 + 0.6 * rand()), poolA = () => rule.poolAmount ?? (0.7 + 0.3 * rand());

  // placed points: sinks (where a stroke touches down, lightest) and pools (where ink collects)
  const placed = (list, type) => (list || []).map((spec, index) => ({ spec, index, type, snap: snapPoint(spec, comps, origin) }))
    .filter(q => q.snap);
  const pls = placed(rule.pools, "pool"), sks = placed(rule.sinks, "sink");
  for (const q of [...pls, ...sks]) covered.add(q.snap.comp.id);
  let used = new Set(pls.map(q => q.index));
  if (rule.poolRandom) {
    // only a few of the pools, picked at random, take ink
    const order = pls.map(q => q.index);
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const [lo, hi] = rule.poolRandom;
    used = new Set(order.slice(0, lo + Math.floor(rand() * (hi - lo + 1))));
  }
  for (const { spec, index, snap } of pls) {
    const u = unit(spec.dir), on = used.has(index);
    points.push({ type: "pool", index, p: snap.p, u, used: on });
    if (!on) continue;
    const r = R(spec.radius ?? poolR()), amt = heavy() * (spec.amount ?? poolA());
    if (!u) pool(snap.p, r, amt, "pool");
    // a directed pool collects at its point and washes back up the stroke it points along, as far as
    // `reach` em or the first crossing
    else fields.push({ p: snap.p, u, r, amt, reach: (spec.reach ?? 0.3) * origin.em, wet });
  }
  for (const { spec, index, snap } of sks) {
    const u = unit(spec.dir);
    points.push({ type: "sink", index, p: snap.p, u, used: true });
    sinks.push({ p: snap.p, u, scale: spec.radius ?? 1 });
  }

  // blobs no placed point touches: guess them
  for (const c of comps) {
    if (covered.has(c.id)) continue;
    const plan = { kind: "auto", comp: c, start: null, end: null };
    strokes.push(plan);
    if (isDot(c, half)) {
      plan.kind = "dot";
      const span = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
      pool([Math.round(c.cx), Math.round(c.cy)], Math.round(span * 0.75), 1.1 * heavy(), "dot");
      continue;
    }
    pruneSpurs(c, half);
    if (!c.ends.length) {
      // closed shape (o): starts and ends at the top
      plan.start = plan.end = extreme(c.skel, "top");
      sinks.push({ p: plan.start, u: null, scale: 1 });
      if (rand() < (hand.closedPoolChance ?? 0.5)) pool(plan.start, R(1.4), 0.6 * heavy(), "pool");
      continue;
    }
    // one stroke from the topmost free end to the lowest; any further free ends belong to a crossbar
    // drawn left to right
    plan.end = extreme(c.ends, "bottom");
    const rest = c.ends.filter(p => p !== plan.end);
    plan.start = extreme(rest, "top") || extreme(c.skel, "top");
    sinks.push({ p: plan.start, u: null, scale: 1 });
    pool(plan.end, R(poolR()), heavy() * poolA(), "pool");
    const bar = rule.crossbar === false ? [] : rest.filter(p => p !== plan.start);
    if (bar.length) {
      const right = extreme(bar, "right");
      if (rand() < 0.6) pool(right, R(1.2), 0.5 * heavy(), "crossbar");
      sinks.push({ p: plan.barStart = extreme(bar, "left"), u: null, scale: 1 });
      plan.barEnd = right;
    }
  }
  const juncs = comps.flatMap(c => c.juncs);
  return { comps, strokes, stamps, sinks: sinks.filter(s => s.p), fields, points, juncs, covered, L };
}

// geodesic distance (in pixels, 8-connected) through the ink from one or more sources. With a direction
// u, the spread is held to a 60° cone near the source (so a point at a junction runs down one branch
// only) and stops at the first crossing it meets beyond that.
function geodesic(B, w, h, sources, u = null, half = 2, juncs = []) {
  const dist = new Float32Array(w * h).fill(Infinity);
  let q = [];
  for (const [x, y] of sources) { const i = y * w + x; if (B[i]) { dist[i] = 0; q.push(i); } }
  let own = 0, gate = 0, stop = null, sx = 0, sy = 0;
  if (u) {
    [sx, sy] = sources[0]; own = (half * 1.2) ** 2; gate = (half * 3.5) ** 2;
    stop = new Uint8Array(w * h);                     // crossings past the gate: reached, not passed
    const zr = Math.ceil(half * 1.5);
    for (const [jx, jy] of juncs) {
      if ((jx - sx) ** 2 + (jy - sy) ** 2 <= gate) continue;
      for (let y = Math.max(0, jy - zr); y <= Math.min(h - 1, jy + zr); y++)
        for (let x = Math.max(0, jx - zr); x <= Math.min(w - 1, jx + zr); x++)
          if ((x - jx) ** 2 + (y - jy) ** 2 <= zr * zr) stop[y * w + x] = 1;
    }
  }
  const allowed = (x, y) => {
    const dx = x - sx, dy = y - sy, d2 = dx * dx + dy * dy;
    if (d2 <= own || d2 > gate) return true;
    return (dx * u[0] + dy * u[1]) >= 0.5 * Math.sqrt(d2);
  };
  while (q.length) {
    const nq = [];
    for (const i of q) {
      if (stop && stop[i]) continue;
      const x = i % w, y = (i / w) | 0, d = dist[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx, nd = d + (dx && dy ? 1.414 : 1);
        if (B[j] && nd < dist[j] && (!u || allowed(nx, ny))) { dist[j] = nd; nq.push(j); }
      }
    }
    q = nq;
  }
  return dist;
}

// distance from the nearest sink, scaled by each sink's radius (1 = the standard light run-in)
function sinkDistance(B, w, h, sinks, half, juncs) {
  const plain = sinks.filter(s => !s.u && s.scale === 1).map(s => s.p);
  const d = plain.length ? geodesic(B, w, h, plain) : new Float32Array(w * h).fill(Infinity);
  for (const s of sinks) {
    if (!s.u && s.scale === 1) continue;
    const g = geodesic(B, w, h, [s.p], s.u, half, juncs), k = 1 / Math.max(0.05, s.scale);
    for (let i = 0; i < g.length; i++) { const v = g[i] * k; if (v < d[i]) d[i] = v; }
  }
  return d;
}

/* ---------- ink deposition ---------- */
// Reference heading size (from the hand). Below it, strokes are shorter and thinner but a pool holds about
// as much ink, so pools reach further along each stroke, the light run-in is shorter and the body is darker.
function sizeScale(sizePx, refSize) { return clamp(refSize / sizePx, 1, 4); }

function simulate(A, w, h, opts, rand) {
  const sc = sizeScale(opts.sizePx, opts.hand.refSize || 92); opts = { ...opts, sc, poolScale: Math.pow(sc, 0.3) };
  const N = w * h, B = new Uint8Array(N);
  let area = 0; for (let i = 0; i < N; i++) if (A[i] > 0.5) { B[i] = 1; area++; }
  const S = skeleton(B, w, h);
  let skelLen = 0; for (let i = 0; i < N; i++) skelLen += S[i];
  const half = Math.max(1.5, area / Math.max(1, skelLen) / 2);          // mean stroke half-width
  const flow = opts.flow;

  // nodes: stroke ends (1 neighbour) pool most; crossings (3+) get overlap ink
  const D = new Float32Array(N), core = new Float32Array(N);   // core: pool heads only, not washes
  const stamp = (cx, cy, r, amt) => {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= r2) { const v = amt * (1 - d2 / r2); D[y * w + x] += v; core[y * w + x] += v; }
      }
  };
  const plan = planStrokes(B, S, w, h, half, flow, opts, rand);
  for (const p of plan.stamps) stamp(p.x, p.y, p.r, p.amt);
  for (const f of plan.fields) {
    // directed pool: a heavy pool at its point, then a wash up the stroke, fading with distance
    const g = geodesic(B, w, h, [f.p], f.u, half, plan.juncs);
    for (let i = 0; i < N; i++) {
      const d = g[i]; if (d === Infinity) continue;
      if (d < f.r) { const v = f.amt * (1 - (d / f.r) ** 2); D[i] += v; core[i] += v; }
      if (d < f.reach) D[i] += (0.22 + 0.25 * (1 - d / f.reach)) * f.wet;
    }
  }
  const sdist = sinkDistance(B, w, h, plan.sinks, half, plan.juncs);

  // pools spread a little along the stroke but not out of it: normalised masked blur
  const Bf = Float32Array.from(B);
  let P = new Float32Array(N); for (let i = 0; i < N; i++) P[i] = D[i] * B[i];
  const r = Math.max(1, Math.round(half * 0.6)), iters = 2 + Math.round(flow * 2);
  const den = boxBlur(Bf, w, h, r);
  for (let k = 0; k < iters; k++) {
    const num = boxBlur(P, w, h, r);
    for (let i = 0; i < N; i++) P[i] = B[i] ? (den[i] > 1e-4 ? num[i] / den[i] : 0) : 0;
  }

  // apron: ink wicked outward from each pool along the stroke, wider and fainter than the pool itself
  let Pw = Float32Array.from(P);
  const rw = Math.max(1, Math.round(half * 1.3));
  const denW = boxBlur(Bf, w, h, rw);
  for (let k = 0; k < 3; k++) {
    const num = boxBlur(Pw, w, h, rw);
    for (let i = 0; i < N; i++) Pw[i] = B[i] ? (denW[i] > 1e-4 ? Math.max(P[i], num[i] / denW[i]) : 0) : 0;
  }

  // base wash: slow variation along the line (nib flow is never even) + paper tooth
  const slow = noise(w, h, half * 16, rand), tooth = noise(w, h, Math.max(1, half * 0.25), rand);
  // W: how far the stroke has got from its start (0 = just touched down, 1 = flowing), plus slow flow variation
  const W = new Float32Array(N), prog = new Float32Array(N), runIn = half * 7 / Math.sqrt(sc);
  for (let i = 0; i < N; i++) {
    W[i] = slow[i];
    const d = sdist[i];                                        // distance from the nearest sink
    // a pool sits on top of a light start (the end of an o lands on its beginning); washes don't
    prog[i] = Math.max(d === Infinity ? 1 : smooth(0, runIn, d), smooth(0.25, 0.6, core[i]));
  }

  // a pool dries with a hard tide line where its ink stops: a band around a threshold of the pool field
  const tide = new Float32Array(N), tl = 0.22;
  for (let i = 0; i < N; i++) { const t = (P[i] - tl) / 0.05; tide[i] = B[i] ? Math.exp(-t * t) : 0; }

  // edge proximity inside the stroke (coffee-ring term)
  const near = boxBlur(Bf, w, h, Math.max(1, Math.round(half * 0.5)));
  const edge = new Float32Array(N);
  for (let i = 0; i < N; i++) edge[i] = B[i] ? clamp((1 - near[i]) * 2.2, 0, 1) : 0;
  const out = { W, prog, P, Pw, tide, edge, tooth, half, small: 1 - 1 / sc, plan, B, S };
  return out;
}


/* ---------- colour ---------- */
const LUT_N = 512, LUT_MAX = 0.62;

// Two curves: the profile's swatch curve (thick films: pools and swabs) and a line curve for
// ordinary writing, which follows the swatch while light and darkens towards `navy` once dark.
function makeTables(profile) {
  const L = profile.lut, navy = profile.navy, navyMean = (navy[0] + navy[1] + navy[2]) / 3;
  const lutOD = d => {
    if (d <= L[0][0]) return [0, 0, 0];
    for (let i = 1; i < L.length; i++) if (d <= L[i][0]) {
      const t = (d - L[i - 1][0]) / (L[i][0] - L[i - 1][0]);
      return [1, 2, 3].map(c => L[i - 1][c] + (L[i][c] - L[i - 1][c]) * t);
    }
    const last = L[L.length - 1]; return [last[1], last[2], last[3]];
  };
  const lineOD = d => {
    const sw = lutOD(d), nv = navy.map(k => k * d / navyMean), t = smooth(0.36, 0.44, d);
    return sw.map((v, c) => v + (nv[c] - v) * t);
  };
  const thickTab = [], lineTab = [];
  for (let i = 0; i < LUT_N; i++) { const d = i / (LUT_N - 1) * LUT_MAX; thickTab.push(lutOD(d)); lineTab.push(lineOD(d)); }
  return { thickTab, lineTab, rim: profile.rim };
}

// density fields -> RGBA transmittance over white paper (multiplied onto the real paper later)
function shade(A, sim, w, h, opts, wordShift) {
  const img = new ImageData(w, h), px = img.data, { W, prog, P, Pw, tide, edge, tooth } = sim;
  const { thickTab, lineTab, rim } = opts.tables, LN10 = Math.LN10;
  const base = 0.26 + 0.06 * wordShift + 0.025 * sim.small, run = 0.16 + 0.1 * opts.flow;
  for (let i = 0; i < w * h; i++) {
    const a = A[i]; if (a < 0.01) continue;
    const p = P[i], pool = smooth(0.14, 0.34, p);             // 0 = plain stroke, 1 = inside a pool
    const apron = smooth(0.03, 0.2, Pw[i]);                   // royal-blue zone around pools
    // the stroke starts at its lightest and darkens along its length; words vary in flow
    let d = base + prog[i] * run + 0.04 * (W[i] - 0.5) + 0.07 * apron + 0.1 * pool + 0.12 * clamp(p - 0.3, 0, 1);
    d += 0.06 * tide[i] + 0.05 * edge[i] * pool;             // tide line and rim darken
    d *= 0.9 + 0.2 * tooth[i];                                // paper tooth
    d = clamp(d, 0, LUT_MAX);
    const k = Math.round(d / LUT_MAX * (LUT_N - 1)), thick = smooth(0.22, 0.45, p);
    const L = lineTab[k], T = thickTab[k];
    let r = L[0] + (T[0] - L[0]) * thick, g = L[1] + (T[1] - L[1]) * thick, b = L[2] + (T[2] - L[2]) * thick;
    if (opts.halo) {
      const hk = clamp(Math.max(tide[i] * smooth(0.3, 0.5, p + 0.2), edge[i] * pool * smooth(0.25, 0.45, p)) * 1.1, 0, 0.9);
      if (hk > 0) { r += (rim[0] * 1.1 - r) * hk; g += (rim[1] * 1.1 - g) * hk; b += (rim[2] * 1.1 - b) * hk; }
    }
    const o = i * 4;
    px[o] = 255 * Math.exp(-r * LN10); px[o + 1] = 255 * Math.exp(-g * LN10); px[o + 2] = 255 * Math.exp(-b * LN10);
    px[o + 3] = 255 * a;
  }
  return img;
}


/* ---------- sprites ---------- */
const TIERS = [-0.8, 0, 0.8];                                  // word flow: lighter, normal, darker
const SIM_MAX_PX = 64;                                         // simulate glyphs at most this many device px tall (font size)

function downsample(A, w, h, wd, hd) {                       // area average
  const out = new Float32Array(wd * hd), cnt = new Float32Array(wd * hd);
  for (let y = 0; y < h; y++) { const yd = Math.min(hd - 1, (y * hd / h) | 0);
    for (let x = 0; x < w; x++) { const i = yd * wd + Math.min(wd - 1, (x * wd / w) | 0); out[i] += A[y * w + x]; cnt[i]++; } }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i] / cnt[i] : 0;
  return out;
}
function upsample(F, wd, hd, w, h) {                         // bilinear
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * hd / h - 0.5), y0 = Math.min(hd - 1, fy | 0), y1 = Math.min(hd - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * wd / w - 0.5), x0 = Math.min(wd - 1, fx | 0), x1 = Math.min(wd - 1, x0 + 1), tx = fx - x0;
      const a = F[y0 * wd + x0], b = F[y0 * wd + x1], c = F[y1 * wd + x0], d = F[y1 * wd + x1];
      out[y * w + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}



function fontMetrics(ctx, family, sizePx) {
  ctx.font = `${sizePx}px ${family}`;
  const m = ctx.measureText("Hgjy");
  return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
}

// does this font have its own glyph for ch? (compares against two different fallbacks)
const glyphCache = new Map();
function hasGlyph(family, ch) {
  const k = family + "\u0000" + ch;
  if (glyphCache.has(k)) return glyphCache.get(k);
  const ctx = hasGlyph.ctx ||= document.createElement("canvas").getContext("2d");
  const wOf = f => { ctx.font = `40px ${f}`; return ctx.measureText(ch).width; };
  const has = wOf(`${family}, monospace`) !== wOf("monospace") || wOf(`${family}, serif`) !== wOf("serif");
  glyphCache.set(k, has);
  return has;
}

/* ---------- one glyph: rasterise, simulate, shade ---------- */
// Draws ch in the given font with optional hand jitter and returns the coverage mask and pen origin.
function rasteriseGlyph(ch, family, fontPx, rand, jitter) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
  const { asc, desc } = fontMetrics(ctx, family, fontPx);
  const adv = ctx.measureText(ch).width, pad = Math.ceil(fontPx * 0.3);
  const w = Math.max(1, Math.ceil(adv + 2 * pad)), h = Math.ceil(asc + desc + 2 * pad);
  c.width = w; c.height = h;
  ctx.font = `${fontPx}px ${family}`; ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic";
  const midY = pad + asc - fontPx * 0.35;
  if (jitter) {
    // a little hand jitter: rotation and scale about the glyph's middle, baseline wobble
    ctx.translate(pad + adv / 2, midY + (rand() - 0.5) * 0.03 * fontPx);
    ctx.rotate((rand() - 0.5) * 0.06);
    const s = 1 + (rand() - 0.5) * 0.05; ctx.scale(s, s);
  } else ctx.translate(pad + adv / 2, midY);
  ctx.fillText(ch, -adv / 2, fontPx * 0.35);
  const data = ctx.getImageData(0, 0, w, h).data, A = new Float32Array(w * h);
  for (let i = 0; i < A.length; i++) A[i] = data[i * 4 + 3] / 255;
  return { c, A, w, h, adv, origin: { x: pad, y: pad + asc, em: fontPx } };
}

// Simulates the ink fields for a mask. Large glyphs are simulated at reduced resolution and the smooth
// fields upsampled; the coverage stays full resolution so outlines stay crisp.
function simulateGlyph(g, ch, sizePx, fontPx, hand, flow, rand) {
  const { A, w, h, origin } = g;
  const f = Math.max(1, fontPx / SIM_MAX_PX);
  const base = { flow, hand, ch, sizePx };
  if (f <= 1.05) return simulate(A, w, h, { ...base, origin }, rand);
  const wd = Math.max(4, Math.round(w / f)), hd = Math.max(4, Math.round(h / f));
  const lo = simulate(downsample(A, w, h, wd, hd), wd, hd, { ...base, origin: { x: origin.x / f, y: origin.y / f, em: origin.em / f } }, rand);
  const sim = { ...lo, lowRes: { f, wd, hd } };
  for (const k of ["W", "prog", "P", "Pw", "tide", "edge", "tooth"]) sim[k] = upsample(lo[k], wd, hd, w, h);
  return sim;
}

// One character shape (with its own jitter) is simulated once and shaded for each requested flow tier.
function buildSprites(ch, sizePx, dpr, seed, cfg, tiers, font) {
  const fontPx = sizePx * dpr, rand = rng(seed);
  const g = rasteriseGlyph(ch, font.family, fontPx, rand, true);
  const sim = simulateGlyph(g, ch, sizePx, fontPx, font.hand, cfg.flow, rand);
  const out = {};
  tiers.forEach((t, n) => {
    const sc = n === 0 ? g.c : Object.assign(document.createElement("canvas"), { width: g.w, height: g.h });
    sc.getContext("2d").putImageData(shade(g.A, sim, g.w, g.h, cfg, TIERS[t]), 0, 0);
    out[t] = { canvas: sc, ox: g.origin.x, oy: g.origin.y, adv: g.adv };   // pen origin inside the sprite
  });
  return out;
}

/* ---------- inspection (used by the font inspector) ---------- */
/** Analyse one glyph without jitter: mask, centreline, blobs, the stroke plan, and any reasons to
 *  check the plan by hand (flags). Coordinates are canvas pixels at sizePx. */
export function analyseGlyph({ ch, family, hand = ERAVAS_PRINT_A, sizePx = 160, flow = 0.55, seed = 1 }) {
  const rand = rng(seed);
  const g = rasteriseGlyph(ch, family, sizePx, rand, false);
  const sim = simulate(g.A, g.w, g.h, { flow, hand, ch, sizePx: hand.refSize || 92, origin: g.origin }, rand);
  const r = (hand.chars || {})[ch] || {}, ruled = !!(r.sinks?.length || r.pools?.length), flags = [];
  const auto = sim.plan.strokes.filter(s => s.kind === "auto");
  if (auto.length > 1) flags.push("several strokes guessed: place their points");
  for (const s of auto) {
    const c = s.comp, n = c.ends.length;
    if (n > 2) flags.push("more than two free ends: crossbar or branch?");
    if (n === 0) flags.push("closed shape: start guessed at the top");
    if (n === 2 && Math.abs(c.ends[0][1] - c.ends[1][1]) < 0.12 * sizePx) flags.push("ends at the same height: direction is a guess");
  }
  return { ...g, sim, plan: sim.plan, flags: [...new Set(flags)], ruled };
}

/** Ink one glyph into a canvas (for previews). tier: 0 light, 1 normal, 2 dark word flow. */
export function inkGlyph({ ch, family, hand = ERAVAS_PRINT_A, profile = SAILORS_SAILOR, sizePx = 92, dpr = 1,
                           flow = 0.55, halo = true, seed = 1, tier = 1 }) {
  const cfg = { flow, halo, tables: makeTables(profile) };
  return buildSprites(ch, sizePx, dpr, seed, cfg, [tier], { family, hand })[tier].canvas;
}

/* ---------- helpers ---------- */
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const mix = (a, b) => fnv(a + ":" + b);
const yieldToMain = () => (globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0)));

const STYLE_ID = "nib-js-style";
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style"); st.id = STYLE_ID;
  st.textContent = `
.ink-host > canvas.ink-canvas { position: absolute; left: 0; top: 0; pointer-events: none; mix-blend-mode: multiply;
  opacity: 0; transition: opacity .25s ease-out; }
.ink-host.ink-on > canvas.ink-canvas { opacity: 1; }
.ink-host.ink-on { color: transparent; transition: color .25s ease-out; }
.ink-host.ink-on :is(a) { text-decoration-color: var(--ink-plain); }
.ink-host.ink-on .ink-skip { color: var(--ink-plain); }
.ink-host.ink-on ::selection { color: transparent; }
@media (prefers-reduced-motion: reduce) { .ink-host > canvas.ink-canvas, .ink-host.ink-on { transition: none; } }
@media (forced-colors: active) {
  .ink-host.ink-on { color: CanvasText; }
  .ink-host > canvas.ink-canvas { display: none; }
}`;
  document.head.appendChild(st);
}

/* ---------- renderer ---------- */
export function createInk(options = {}) {
  const cfg = {
    profile: SAILORS_SAILOR,
    flow: 0.55,                // 0 dry … 1 wet
    halo: true,                // red-violet rims on heavy pools
    variants: 2,               // jitter variants per character and font (each shaded in 3 flow tiers); 1 if several fonts
    uniqueUnder: 40,           // elements with fewer glyphs than this (titles) get a unique sprite per letter
    skip: "code, pre, kbd, samp, .no-ink",
    salt: 0,                   // change to re-ink everything differently
    rootMargin: "100% 0px",    // ink elements this close to the viewport
    maxDpr: 2,
    ...options,
  };
  // Fonts: the first one lays out the text (set it on the elements); every font, including the first,
  // is a variant that letters pick from at random. Each font carries its own hand (where strokes start and ink pools).
  cfg.fonts = (options.fonts || [{ family: options.font || '"eravas print a"', hand: options.hand }])
    .map(f => (typeof f === "string" ? { family: f } : f))
    .map(f => ({ weight: 1, ...f, hand: f.hand || options.hand || ERAVAS_PRINT_A }));
  for (const f of cfg.fonts) if ((f.hand.format || 1) < 2)
    console.warn(`nib.js: the hand for ${f.family} is format 1, which isn't supported since Rev.B; place its points again in the inspector.`);
  // several fonts already vary each letter's shape, so by default one jitter variant per font is enough
  if (options.variants == null && cfg.fonts.length > 1) cfg.variants = 1;
  cfg.tables = makeTables(cfg.profile);
  injectStyle();

  const atlas = new Map(), hosts = new Map(), measure = document.createElement("canvas").getContext("2d");
  const layoutFamily = cfg.fonts[0].family;
  let enabled = true, queue = Promise.resolve();
  const stats = { sprites: 0, glyphs: 0, lastMs: 0, built: 0 };

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const st = hosts.get(e.target); if (!st) continue;
      st.visible = e.isIntersecting;
      if (st.visible && (!st.rendered || st.dirty)) schedule(e.target);
      else if (!st.visible && st.rendered) release(e.target);
    }
  }, { rootMargin: cfg.rootMargin });

  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const st = hosts.get(e.target); if (!st) continue;
      const w = Math.round(e.contentRect.width);
      if (st.width < 0) { st.width = w; continue; }           // initial size, not a change
      if (w === st.width) continue;
      st.width = w; st.dirty = true;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => st.visible && schedule(e.target), 120);
    }
  });

  // browser zoom changes the pixel ratio: rebuild sprites at the new resolution
  let dprQuery;
  const watchDpr = () => {
    dprQuery?.removeEventListener("change", onDpr);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", onDpr);
  };
  const onDpr = () => { atlas.clear(); for (const [el, st] of hosts) { st.dirty = true; if (st.visible) schedule(el); } watchDpr(); };
  watchDpr();

  function schedule(el) { queue = queue.then(() => render(el)).catch(err => console.error("nib.js", err)); return queue; }

  function release(el) {
    const st = hosts.get(el);
    el.classList.remove("ink-on");
    if (st.canvas) { st.canvas.width = st.canvas.height = 0; }
    st.rendered = false;
  }

  // weighted pick among the fonts that have this character
  function pickFont(ch, r) {
    const ok = cfg.fonts.map((f, i) => [f, i]).filter(([f, i]) => i === 0 || hasGlyph(f.family, ch));
    let t = (r / 4294967296) * ok.reduce((s, [f]) => s + f.weight, 0);
    for (const [f, i] of ok) { t -= f.weight; if (t < 0) return i; }
    return 0;
  }

  // pen positions of every character, in the host's padding-box coordinates (CSS px)
  function placeGlyphs(el) {
    const r0 = el.getBoundingClientRect(), ox = r0.left + el.clientLeft, oy = r0.top + el.clientTop;
    const out = [], range = document.createRange(), ascBySize = new Map();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement.closest(cfg.skip) && el.contains(n.parentElement.closest(cfg.skip)))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let word = 0;
    for (let node; (node = walker.nextNode());) {
      const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
      if (!ascBySize.has(size)) ascBySize.set(size, fontMetrics(measure, layoutFamily, size).asc);
      const asc = ascBySize.get(size);
      measure.font = `${size}px ${layoutFamily}`;
      const text = node.nodeValue, re = /\S+/g;
      for (let m; (m = re.exec(text));) {
        range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects(), chars = [...m[0]];
        if (rects.length === 1) {
          const r = rects[0], base = r.top - oy + asc;
          let pre = "";
          chars.forEach((ch, ci) => {
            out.push({ ch, x: r.left - ox + measure.measureText(pre).width, y: base, size, word, ci, adv: measure.measureText(ch).width });
            pre += ch;
          });
        } else {
          // the word is broken across lines: place character by character
          let off = m.index;
          chars.forEach((ch, ci) => {
            range.setStart(node, off); range.setEnd(node, off + ch.length); off += ch.length;
            const r = range.getClientRects()[0];
            if (r) out.push({ ch, x: r.left - ox, y: r.top - oy + asc, size, word, ci, adv: measure.measureText(ch).width });
          });
        }
        word++;
      }
    }
    return out;
  }

  async function render(el) {
    const st = hosts.get(el);
    if (!enabled || !st || !st.visible) return;
    const token = ++st.token, t0 = performance.now();
    const size = parseFloat(getComputedStyle(el).fontSize);
    await Promise.all(cfg.fonts.map(f => document.fonts.load(`${size}px ${f.family}`)));
    if (token !== st.token) return;

    const dpr = Math.min(cfg.maxDpr, devicePixelRatio || 1);
    const glyphs = placeGlyphs(el);
    const seed = mix(fnv(el.textContent), cfg.salt);
    const unique = glyphs.length < cfg.uniqueUnder;
    const base = `${dpr}|${cfg.flow}|${cfg.halo}|${cfg.salt}`;

    // build any missing sprites, yielding every ~8 ms so scrolling stays smooth
    let slice = performance.now();
    for (const g of glyphs) {
      g.tier = mix(seed, g.word) % 3;
      g.font = cfg.fonts.length > 1 ? pickFont(g.ch, mix(seed, g.word * 7919 + g.ci)) : 0;
      const variant = unique ? `u${seed}:${g.word}:${g.ci}` : mix(seed, g.word * 977 + g.ci) % cfg.variants;
      g.key = `${g.ch}|${g.font}|${g.size}|${variant}|${base}`;
      let entry = atlas.get(g.key);
      if (!entry || !entry[g.tier]) {
        const built = buildSprites(g.ch, g.size, dpr, mix(g.key, cfg.salt), cfg, unique ? [g.tier] : [0, 1, 2], cfg.fonts[g.font]);
        entry = Object.assign(entry || {}, built); atlas.set(g.key, entry);
        stats.built++;
        if (performance.now() - slice > 8) { await yieldToMain(); if (token !== st.token || !enabled) return; slice = performance.now(); }
      }
    }

    // paint
    if (!st.canvas) {
      st.canvas = document.createElement("canvas");
      st.canvas.className = "ink-canvas"; st.canvas.setAttribute("aria-hidden", "true");
      el.appendChild(st.canvas);
    }
    // the canvas overhangs the element by a margin: descenders, pools and jitter often reach past the
    // line boxes (tight line-height, first/last line), and would otherwise be clipped
    const m = Math.ceil(Math.max(...glyphs.map(g => g.size), size) * 0.6);
    const cw = el.clientWidth + 2 * m, chh = el.clientHeight + 2 * m, cv = st.canvas;
    cv.width = Math.ceil(cw * dpr); cv.height = Math.ceil(chh * dpr);
    cv.style.width = cw + "px"; cv.style.height = chh + "px";
    cv.style.left = cv.style.top = -m + "px";
    const ctx = cv.getContext("2d");
    ctx.globalCompositeOperation = "multiply";                 // overlapping strokes darken each other
    for (const g of glyphs) {
      const s = atlas.get(g.key)[g.tier];
      // a variant glyph is centred in the layout font's advance, so spacing stays the layout font's
      const dx = (g.adv * dpr - s.adv) / 2;
      ctx.drawImage(s.canvas, Math.round((g.x + m) * dpr + dx - s.ox), Math.round((g.y + m) * dpr - s.oy));
    }
    el.style.setProperty("--ink-plain", st.plainColor);
    el.classList.add("ink-on");
    st.rendered = true; st.dirty = false;
    stats.sprites = atlas.size; stats.glyphs = glyphs.length; stats.lastMs = performance.now() - t0;
  }

  return {
    /** Ink these elements (an element, NodeList or array). Text stays plain until its ink is ready. */
    attach(targets) {
      for (const el of (targets instanceof Element ? [targets] : targets)) {
        if (hosts.has(el)) continue;
        if (getComputedStyle(el).position === "static") el.style.position = "relative";
        el.classList.add("ink-host");
        el.querySelectorAll(cfg.skip).forEach(n => n.classList.add("ink-skip"));
        hosts.set(el, { visible: false, rendered: false, dirty: true, token: 0, width: -1, canvas: null,
                        plainColor: getComputedStyle(el).color });
        io.observe(el); ro.observe(el);
      }
    },
    /** Stop inking these elements and restore plain text. */
    detach(targets) {
      for (const el of (targets instanceof Element ? [targets] : targets)) {
        const st = hosts.get(el); if (!st) continue;
        io.unobserve(el); ro.unobserve(el);
        st.token++; st.canvas?.remove();
        el.classList.remove("ink-on", "ink-host");
        hosts.delete(el);
      }
    },
    /** false = plain text everywhere (accessibility / preference); true = ink again. */
    setEnabled(on) {
      enabled = !!on;
      for (const [el, st] of hosts) {
        st.token++;
        if (!enabled) release(el); else if (st.visible) schedule(el);
      }
    },
    /** Change options (flow, halo, salt, profile, fonts, …) and re-ink. */
    refresh(opts = {}) {
      Object.assign(cfg, opts);
      if (opts.profile) cfg.tables = makeTables(cfg.profile);
      if (opts.fonts) cfg.fonts = opts.fonts.map(f => ({ weight: 1, ...(typeof f === "string" ? { family: f } : f) }))
        .map(f => ({ ...f, hand: f.hand || ERAVAS_PRINT_A }));
      atlas.clear();
      for (const [el, st] of hosts) { st.dirty = true; if (st.visible && enabled) schedule(el); }
      return queue;
    },
    /** Resolves when everything queued so far has been inked. */
    idle() { return queue; },
    get enabled() { return enabled; },
    stats,
  };
}
