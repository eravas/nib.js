// Minimal WOFF2 <-> OTF converter for CFF-flavoured fonts (no glyf/loca transforms), using the Brotli
// built into Node. Used to build the example font's .woff2 from its .otf after metadata edits.
// usage (from the repo root):
//   node tools/woff2.mjs encode fonts/eravas-print-a/eravas-print-a.otf fonts/eravas-print-a/eravas-print-a.woff2
//   node tools/woff2.mjs decode in.woff2 out.otf
import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

const KNOWN = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];
const pad4 = n => (n + 3) & ~3;

function readBase128(buf, o) {
  let v = 0;
  for (let i = 0; i < 5; i++) { const b = buf[o.p++]; if (i === 0 && b === 0x80) throw Error("leading zero"); v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
  throw Error("bad UIntBase128");
}
function writeBase128(v) {
  const out = []; do { out.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v);
  return out.map((b, i) => (i < out.length - 1 ? b | 0x80 : b));
}

function buildSfnt(flavor, tables) {               // tables: [{tag, data}] -> OTF bytes, tags sorted
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length, headerLen = 12 + 16 * n;
  let size = headerLen; for (const t of tables) size += pad4(t.data.length);
  const out = Buffer.alloc(size);
  out.writeUInt32BE(flavor, 0); out.writeUInt16BE(n, 4);
  let es = 1, p2 = 0; while (es * 2 <= n) { es *= 2; p2++; }
  out.writeUInt16BE(es * 16, 6); out.writeUInt16BE(p2, 8); out.writeUInt16BE(n * 16 - es * 16, 10);
  let off = headerLen;
  tables.forEach((t, i) => {
    const d = t.data, e = 12 + 16 * i; let sum = 0;
    const padded = Buffer.alloc(pad4(d.length)); d.copy(padded);
    for (let k = 0; k < padded.length; k += 4) sum = (sum + padded.readUInt32BE(k)) >>> 0;
    out.write(t.tag, e, "latin1"); out.writeUInt32BE(sum, e + 4); out.writeUInt32BE(off, e + 8); out.writeUInt32BE(d.length, e + 12);
    padded.copy(out, off); off += padded.length;
  });
  return out;
}

function decode(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw Error("not WOFF2");
  const flavor = buf.readUInt32BE(4), numTables = buf.readUInt16BE(12), compLen = buf.readUInt32BE(20);
  const o = { p: 48 }, dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[o.p++], tag = (flags & 63) === 63 ? buf.toString("latin1", o.p, (o.p += 4)) : KNOWN[flags & 63];
    const version = flags >> 6, origLength = readBase128(buf, o);
    const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
    const length = transformed ? readBase128(buf, o) : origLength;
    if (transformed) throw Error(`transformed table ${tag} not supported (CFF fonts only)`);
    dir.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(o.p, o.p + compLen));
  let p = 0; const tables = dir.map(d => { const t = { tag: d.tag, data: Buffer.from(data.subarray(p, p + d.length)) }; p += d.length; return t; });
  return buildSfnt(flavor, tables);
}

function encode(sfnt) {
  const flavor = sfnt.readUInt32BE(0), n = sfnt.readUInt16BE(4), tables = [];
  for (let i = 0; i < n; i++) {
    const e = 12 + 16 * i, tag = sfnt.toString("latin1", e, e + 4), off = sfnt.readUInt32BE(e + 8), len = sfnt.readUInt32BE(e + 12);
    if (tag === "glyf" || tag === "loca") throw Error("TrueType outlines not supported (CFF fonts only)");
    tables.push({ tag, data: sfnt.subarray(off, off + len) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const dirBytes = [];
  let totalSfnt = 12 + 16 * n;
  for (const t of tables) {
    const k = KNOWN.indexOf(t.tag);
    if (k >= 0) dirBytes.push(k);                                   // transform version 0 = null transform
    else dirBytes.push(63, ...Buffer.from(t.tag, "latin1"));
    dirBytes.push(...writeBase128(t.data.length));
    totalSfnt += pad4(t.data.length);
  }
  const comp = brotliCompressSync(Buffer.concat(tables.map(t => t.data)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT } });
  const length = pad4(48 + dirBytes.length + comp.length);
  const out = Buffer.alloc(length);
  out.write("wOF2", 0, "latin1"); out.writeUInt32BE(flavor, 4); out.writeUInt32BE(length, 8);
  out.writeUInt16BE(n, 12); out.writeUInt32BE(totalSfnt, 16); out.writeUInt32BE(comp.length, 20);
  out.writeUInt16BE(1, 24); out.writeUInt16BE(0, 26);             // version 1.0; no metadata/private blocks
  Buffer.from(dirBytes).copy(out, 48); comp.copy(out, 48 + dirBytes.length);
  return out;
}

const [cmd, inp, outp] = process.argv.slice(2);
const res = cmd === "decode" ? decode(readFileSync(inp)) : encode(readFileSync(inp));
writeFileSync(outp, res);
console.log(`${cmd}: ${inp} (${readFileSync(inp).length} B) -> ${outp} (${res.length} B)`);
