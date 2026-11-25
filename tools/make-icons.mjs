// Generates the TAG//OPS app icons (PNG) with no dependencies.
// Usage (from the project folder):  node tools/make-icons.mjs
// Art: dark square, faint grid, teal targeting reticle. Full-bleed, with the reticle inside the
// central 72% so it also works as an Android "maskable" icon and under iOS's rounded-corner mask.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [5, 7, 10], GRID = [14, 22, 26], FG = [62, 230, 196];
const SS = 4; // supersampling for smooth edges

function coverage(x, y, s) {
  const c = s / 2, dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
  const w = s * 0.055;                    // stroke width
  const r = s * 0.2;                      // ring radius
  const inner = s * 0.075, outer = s * 0.34; // crosshair segments (gap in the middle)
  if (Math.abs(d - r) <= w / 2) return 1;
  if (Math.abs(dx) <= w / 2 && Math.abs(dy) >= inner && Math.abs(dy) <= outer) return 1;
  if (Math.abs(dy) <= w / 2 && Math.abs(dx) >= inner && Math.abs(dx) <= outer) return 1;
  if (d <= s * 0.028) return 1;           // center dot
  return 0;
}
function isGrid(x, y, s) {
  const step = s / 8, t = Math.max(1, s / 256);
  return (x % step) < t || (y % step) < t;
}

function render(size) {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let fg = 0, grid = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      fg += coverage(X, Y, size); grid += isGrid(X, Y, size) ? 1 : 0;
    }
    fg /= SS * SS; grid /= SS * SS;
    const base = BG.map((b, i) => b + (GRID[i] - b) * grid);
    const col = base.map((b, i) => Math.round(b + (FG[i] - b) * fg));
    col.forEach((v, i) => (px[(y * size + x) * 3 + i] = v));
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = render(size), raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 3 + 1)] = 0; px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("icons", { recursive: true });
for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`icons/${file}`, png(size));
  console.log(`icons/${file}`);
}
