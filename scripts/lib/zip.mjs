// Builds the extension package as a zip, byte-for-byte reproducible: files
// are stored uncompressed, sorted, with fixed timestamps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, packagedFiles } from '../files.mjs';
import { crc32 } from './crc32.mjs';

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_FLAG = 0x0800;

export function readVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
}

// Returns { zip, count }.
export function buildPackageZip() {
  const files = packagedFiles();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const rel of files) {
    let data = readFileSync(join(ROOT, rel));
    if (rel === 'manifest.json') {
      // The "key" field pins the extension ID for unpacked installs. The Chrome
      // Web Store rejects uploads that contain it, so it is left out of the zip.
      // A CRX carries the same public key in its header instead.
      const manifest = JSON.parse(data.toString('utf8'));
      delete manifest.key;
      data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(UTF8_FLAG, 6);
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(UTF8_FLAG, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);

  return { zip: Buffer.concat([...locals, cd, end]), count: files.length };
}
