import * as yauzl from 'yauzl';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const filename = '.tmp/lhp-vscode-0.1.1.vsix';
const required = new Set([
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/dist/webview.js',
  'extension/dist/webview.css',
  'extension/dist/THIRD_PARTY_LICENSES.txt',
  'extension/bridge/lhp_bridge.py',
  'extension/media/icon.png',
  'extension/LICENSE.txt',
  'extension/NOTICE',
]);
const names = [];
const archive = await new Promise((resolve, reject) =>
  yauzl.open(filename, { lazyEntries: true }, (error, zip) =>
    error ? reject(error) : resolve(zip),
  ),
);
await new Promise((resolve, reject) => {
  archive.on('error', reject);
  archive.on('end', resolve);
  archive.on('entry', (entry) => {
    const name = entry.fileName;
    names.push(name);
    required.delete(name);
    if (
      /node_modules|__pycache__|\.pyc$|(^|\/)\.env|(^|\/)(tests|\.tmp|\.git|src)\/|\.map$/.test(
        name,
      )
    ) {
      archive.close();
      reject(new Error(`Unexpected development/private file: ${name}`));
      return;
    }
    if (
      name.startsWith('extension/') &&
      !/^extension\/(dist\/|bridge\/lhp_bridge\.py$|media\/|package\.json$|README\.md$|LICENSE(?:\.txt)?$|NOTICE$|THIRD_PARTY_NOTICES\.md$|CHANGELOG\.md$)/i.test(
        name,
      )
    ) {
      archive.close();
      reject(new Error(`File outside package allowlist: ${name}`));
      return;
    }
    if (entry.uncompressedSize > 8 * 1024 * 1024) {
      archive.close();
      reject(new Error(`Unexpected large asset: ${name}`));
      return;
    }
    archive.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => {
        if (/\.(?:js|css|py|json|md|txt|svg)$/.test(name)) {
          const content = Buffer.concat(chunks).toString('utf8');
          if (
            /\/Users\/|\/home\/node\/|npm-proxy\.dev\.databricks\.com|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(
              content,
            )
          ) {
            archive.close();
            reject(new Error(`Local path/private material in ${name}`));
            return;
          }
        }
        archive.readEntry();
      });
    });
  });
  archive.readEntry();
});
if (required.size) throw new Error(`Missing packaged assets: ${[...required].join(', ')}`);
const bytes = await readFile(filename);
if (bytes.length > 5 * 1024 * 1024) throw new Error('VSIX exceeds the expected 5 MB budget.');
console.log(
  `Audited ${names.length} files; ${bytes.length} bytes; SHA256 ${createHash('sha256').update(bytes).digest('hex')}`,
);
