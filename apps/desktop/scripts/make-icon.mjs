// Kalkan simgesini (PNG) saf Node ile üretir: resources/icon.png (256x256) ve tray.png (32x32).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Kalkan: üstte düz, altta sivrilen; içinde onay işareti. Anti-aliasing için 3x3 örnekleme.
function inShield(u, v) {
  if (u < 0.24 || u > 0.76 || v < 0.16 || v > 0.86) return false;
  const half = 0.26;
  const cx = 0.5;
  if (v < 0.5) return Math.abs(u - cx) <= half;
  const t = (v - 0.5) / 0.36;
  return Math.abs(u - cx) <= half * (1 - t * t);
}
function inCheck(u, v) {
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(u - (ax + t * dx), v - (ay + t * dy)) < 0.035;
  };
  return seg(0.4, 0.5, 0.47, 0.58) || seg(0.47, 0.58, 0.62, 0.4);
}
function pixel(u, v, size) {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const uu = u + (i - 1) / (3 * size), vv = v + (j - 1) / (3 * size);
    const rr = Math.hypot(uu - 0.5, vv - 0.5);
    const inBg = rr < 0.48;
    let c = [0, 0, 0, 0];
    if (inBg) c = [99, 102, 241, 255];
    if (inBg && inShield(uu, vv)) c = inCheck(uu, vv) ? [99, 102, 241, 255] : [255, 255, 255, 255];
    r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; n++;
  }
  return a === 0 ? [0, 0, 0, 0] : [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)];
}
writeFileSync(join(out, 'icon.png'), png(256, pixel));
writeFileSync(join(out, 'tray.png'), png(32, pixel));
console.log('İkonlar üretildi:', out);
