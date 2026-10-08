const test = require('node:test');
const assert = require('node:assert/strict');
const DV = require('./helpers.js');
const { parseFolderUrl, extractAccountEmail } = DV.drivePage;

test('folder URLs are recognised in My Drive, shared drives and multi-account paths', () => {
  assert.deepEqual(parseFolderUrl('https://drive.google.com/drive/folders/1AbC_d-EfGh'), { folderId: '1AbC_d-EfGh', resourceKey: null });
  assert.deepEqual(parseFolderUrl('https://drive.google.com/drive/u/2/folders/0ABcdEFgh12Uk9PVA'), { folderId: '0ABcdEFgh12Uk9PVA', resourceKey: null });
  assert.deepEqual(parseFolderUrl('https://drive.google.com/drive/folders/1AbCdEf?usp=sharing'), { folderId: '1AbCdEf', resourceKey: null });
  assert.deepEqual(parseFolderUrl('https://drive.google.com/drive/folders/1AbCdEf?resourcekey=0-abc_DEF'), { folderId: '1AbCdEf', resourceKey: '0-abc_DEF' });
});

test('non-folder pages are ignored', () => {
  for (const url of [
    'https://drive.google.com/drive/my-drive',
    'https://drive.google.com/drive/u/0/home',
    'https://drive.google.com/drive/recent',
    'https://drive.google.com/drive/search?q=report',
    'https://drive.google.com/drive/shared-drives',
    'https://drive.google.com/file/d/1AbCdEf/view',
    'https://drive.google.com/drive/folders/',
    'https://drive.google.com/drive/folders/../../x',
    'https://evil.example/drive/folders/1AbCdEf',
    'not a url',
  ]) {
    assert.equal(parseFolderUrl(url), null, url);
  }
});

test('invalid resource keys are dropped', () => {
  assert.equal(parseFolderUrl('https://drive.google.com/drive/folders/1AbCdEf?resourcekey=a/b').resourceKey, null);
});

test('the Drive account is read from the account button label', () => {
  assert.equal(extractAccountEmail(['Google Account: Ada Lovelace  \n(Ada@Example.org)']), 'ada@example.org');
  assert.equal(extractAccountEmail(['Compte Google : Ada (ada@example.org)', 'ada@example.org']), 'ada@example.org');
});

test('missing or ambiguous account yields null, so the banner shows Unknown', () => {
  assert.equal(extractAccountEmail([]), null);
  assert.equal(extractAccountEmail(['Google Account']), null);
  assert.equal(extractAccountEmail(['a@example.org', 'b@example.org']), null);
});
