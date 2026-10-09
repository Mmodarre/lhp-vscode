import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { auditPackage, REQUIRED_ASSETS } from '../../scripts/package-audit.mjs';
import { CORE_COMMIT } from '../../scripts/release-policy.mjs';

const commit = 'a'.repeat(40);
const manifest = {
  name: 'lhp-vscode',
  publisher: 'MEHDIMODARRESSI',
  version: '0.3.1',
  main: './dist/extension.js',
  icon: 'media/icon.png',
};
const xml = `<PackageManifest><Metadata><Identity Id="lhp-vscode" Publisher="MEHDIMODARRESSI" Version="0.3.1"/><Properties><Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true"/></Properties></Metadata></PackageManifest>`;
function files() {
  const result = new Map(REQUIRED_ASSETS.map((name) => [name, Buffer.from('fixture')]));
  result.set('extension/package.json', Buffer.from(JSON.stringify(manifest)));
  result.set('extension.vsixmanifest', Buffer.from(xml));
  result.set('extension/dist/extension.js', Buffer.from(`const core = '${CORE_COMMIT}';`));
  return result;
}
async function withArchive(entries, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lhp-release-'));
  try {
    const zip = new yazl.ZipFile();
    const chunks = [];
    const bytes = new Promise((resolve, reject) => {
      zip.outputStream.on('data', (chunk) => chunks.push(chunk));
      zip.outputStream.on('error', reject);
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    });
    for (const [name, content] of entries) zip.addBuffer(content, name);
    zip.end();
    const filename = path.join(directory, 'fixture.vsix');
    await writeFile(filename, await bytes);
    await operation(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('audits a complete universal pre-release and returns content checksum', async () => {
  await withArchive(files(), async (filename) => {
    const result = await auditPackage(filename, { manifest, commit });
    assert.equal(result.files, REQUIRED_ASSETS.length);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.bytes > 0);
  });
});
for (const [label, edit, pattern] of [
  [
    'wrong publisher',
    (entries) =>
      entries.set('extension.vsixmanifest', Buffer.from(xml.replace('MEHDIMODARRESSI', 'OTHER'))),
    /identity/,
  ],
  [
    'wrong version',
    (entries) => entries.set('extension.vsixmanifest', Buffer.from(xml.replace('0.3.1', '0.3.0'))),
    /identity/,
  ],
  [
    'platform-specific',
    (entries) =>
      entries.set(
        'extension.vsixmanifest',
        Buffer.from(xml.replace('Id="lhp-vscode"', 'Id="lhp-vscode" TargetPlatform="linux-x64"')),
      ),
    /universal/,
  ],
  [
    'stable metadata',
    (entries) =>
      entries.set(
        'extension.vsixmanifest',
        Buffer.from(xml.replace('Value="true"', 'Value="false"')),
      ),
    /pre-release/,
  ],
  [
    'missing prerelease metadata',
    (entries) =>
      entries.set(
        'extension.vsixmanifest',
        Buffer.from(xml.replace(/<Properties>.*<\/Properties>/, '')),
      ),
    /pre-release/,
  ],
  [
    'XML entity declarations',
    (entries) => entries.set('extension.vsixmanifest', Buffer.from(`<!DOCTYPE test>${xml}`)),
    /declaration/,
  ],
  [
    'manifest tampering',
    (entries) =>
      entries.set(
        'extension/package.json',
        Buffer.from(JSON.stringify({ ...manifest, version: '0.3.2' })),
      ),
    /source manifest/,
  ],
  [
    'missing original icon',
    (entries) => entries.delete('extension/media/icon.png'),
    /Missing packaged asset/,
  ],
  [
    'core pin changed',
    (entries) => entries.set('extension/dist/extension.js', Buffer.from('wrong core')),
    /core revision/,
  ],
  [
    'private path',
    (entries) => entries.set('extension/readme.md', Buffer.from('/Users/example/project')),
    /private material/,
  ],
  [
    'development source',
    (entries) => entries.set('extension/src/test.ts', Buffer.from('code')),
    /allowlist/,
  ],
  [
    'extra private build file',
    (entries) => entries.set('extension/dist/key.pem', Buffer.from('secret')),
    /allowlist/,
  ],
  [
    'unexpected archive root',
    (entries) => entries.set('secret.txt', Buffer.from('secret')),
    /allowlist/,
  ],
  [
    'mutable screenshot URL',
    (entries) =>
      entries.set(
        'extension/readme.md',
        Buffer.from(
          '![screen](https://github.com/Mmodarre/lhp-vscode/raw/main/docs/images/screen.png)',
        ),
      ),
    /source link/,
  ],
])
  test(`rejects ${label}`, async () => {
    const entries = files();
    edit(entries);
    await withArchive(entries, (filename) =>
      assert.rejects(auditPackage(filename, { manifest, commit }), pattern),
    );
  });
test('rejects duplicate zip paths instead of allowing last-entry replacement', async () => {
  await withArchive(
    [...files(), ['extension/package.json', Buffer.from(JSON.stringify(manifest))]],
    (filename) => assert.rejects(auditPackage(filename, { manifest, commit }), /duplicate/),
  );
});
