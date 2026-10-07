// Generates icons/icon{16,32,48,128}.png deterministically, with no dependencies.
// The icon is an eye on a dark rounded square ("visibility").
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './lib/crc32.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [60, 64, 67];
const FG = [255, 255, 255];
const SS = 4; // supersampling per axis

function inRoundedSquare(x, y) {
  const m = 0.04, r = 0.22;
  if (x < m || y < m || x > 1 - m || y > 1 - m) return false;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Almond: intersection of two circles, half-width 0.34, half-height 0.2.
function inEye(x, y) {
  const d = 0.189, R = 0.389;
  return (x - 0.5) ** 2 + (y - 0.5 - d) ** 2 <= R * R && (x - 0.5) ** 2 + (y - 0.5 + d) ** 2 <= R * R;
}

function sample(x, y) {
  if (!inRoundedSquare(x, y)) return null;
  const r = Math.hypot(x - 0.5, y - 0.5);
  if (r <= 0.05) return FG;
  if (r <= 0.13) return BG;
  return inEye(x, y) ? FG : BG;
}

function render(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < SS; i++) {
        for (let j = 0; j < SS; j++) {
          const c = sample((px + (i + 0.5) / SS) / size, (py + (j + 0.5) / SS) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
      }
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return raw;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(ROOT, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(ROOT, 'icons', `icon${size}.png`), png(size));
  console.log(`icons/icon${size}.png`);
}
