// CRX3 signing and the update manifest Chrome polls for self-hosted extensions.
//
// A CRX3 file is: "Cr24", version 3, header length, a CrxFileHeader protobuf,
// then the zip. The header holds the public key and an RSA-SHA256 signature
// over "CRX3 SignedData\0" + length + SignedData + zip, where SignedData
// carries the extension ID's 16 raw bytes. The signature is PKCS#1 v1.5, so the
// same key and zip always produce the same file.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

// A length-delimited protobuf field (wire type 2).
function field(num, bytes) {
  return Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);
}

function uint32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

// Chrome's extension ID: the first 16 bytes of sha256(public key DER), each hex
// digit mapped from 0-f to a-p.
export function extensionId(publicKeyDer) {
  const hex = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export function publicKeyDer(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
}

export function buildCrx(zip, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  const pub = publicKeyDer(privateKeyPem);
  const crxId = createHash('sha256').update(pub).digest().subarray(0, 16);
  const signedData = field(1, crxId);

  const signature = sign('sha256', Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'utf8'),
    uint32le(signedData.length),
    signedData,
    zip,
  ]), key);

  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, pub), field(2, signature)])), // sha256_with_rsa
    field(10000, signedData), // signed_header_data
  ]);

  return {
    crx: Buffer.concat([Buffer.from('Cr24', 'ascii'), uint32le(3), uint32le(header.length), header, zip]),
    id: extensionId(pub),
  };
}

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function updateManifest(id, version, crxUrl) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${escapeXml(id)}'>
    <updatecheck codebase='${escapeXml(crxUrl)}' version='${escapeXml(version)}' />
  </app>
</gupdate>
`;
}
