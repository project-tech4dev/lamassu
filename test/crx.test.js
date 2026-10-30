// CRX3 signing and the update manifest (scripts/lib/crx.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createPublicKey, verify } = require('node:crypto');

const lib = import('../scripts/lib/crx.mjs');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Minimal protobuf reader for length-delimited fields.
function readFields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let n = 0, shift = 0, b;
    do { b = buf[i++]; n += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return n;
  };
  while (i < buf.length) {
    const tag = varint();
    assert.equal(tag & 7, 2, 'only length-delimited fields expected');
    const len = varint();
    out.push({ num: Math.floor(tag / 8), bytes: buf.subarray(i, i + len) });
    i += len;
  }
  return out;
}

test('CRX3 file has a valid header and signature over the zip', async () => {
  const { buildCrx, extensionId } = await lib;
  const zip = Buffer.from('PK fake zip contents');
  const { crx, id } = buildCrx(zip, pem);

  assert.equal(crx.subarray(0, 4).toString('ascii'), 'Cr24');
  assert.equal(crx.readUInt32LE(4), 3);
  const headerLen = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLen);
  assert.deepEqual(crx.subarray(12 + headerLen), zip);

  const fields = readFields(header);
  const proof = readFields(fields.find((f) => f.num === 2).bytes);
  const pub = proof.find((f) => f.num === 1).bytes;
  const signature = proof.find((f) => f.num === 2).bytes;
  const signedData = fields.find((f) => f.num === 10000).bytes;

  const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  assert.deepEqual(pub, der);
  assert.equal(id, extensionId(der));
  assert.match(id, /^[a-p]{32}$/);

  const crxId = readFields(signedData).find((f) => f.num === 1).bytes;
  assert.equal(crxId.length, 16);
  assert.equal([...crxId.toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''), id);

  const lenLE = Buffer.alloc(4);
  lenLE.writeUInt32LE(signedData.length);
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\0'), lenLE, signedData, zip]);
  assert.ok(verify('sha256', message, createPublicKey({ key: pub, format: 'der', type: 'spki' }), signature));
});

test('signing is deterministic', async () => {
  const { buildCrx } = await lib;
  const zip = Buffer.from('same zip');
  assert.deepEqual(buildCrx(zip, pem).crx, buildCrx(zip, pem).crx);
});

test('the pinned manifest key produces the expected extension ID', async () => {
  const { extensionId } = await lib;
  const manifest = require('../manifest.json');
  assert.equal(extensionId(Buffer.from(manifest.key, 'base64')), 'illeibibgkgdeofodggpkgflfhlpphde');
});

test('update manifest names the ID, version and escaped CRX URL', async () => {
  const { updateManifest } = await lib;
  const xml = updateManifest('abcdefghijklmnopabcdefghijklmnop', '1.2.3', "https://h/x.crx?a=1&b='2'");
  assert.match(xml, /appid='abcdefghijklmnopabcdefghijklmnop'/);
  assert.match(xml, /version='1\.2\.3'/);
  assert.match(xml, /codebase='https:\/\/h\/x\.crx\?a=1&#38;b=&#39;2&#39;'/);
});
