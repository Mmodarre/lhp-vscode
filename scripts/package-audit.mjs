import * as yauzl from 'yauzl';
import { parseStringPromise } from 'xml2js';
import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertSourceManifest, CORE_COMMIT, REPOSITORY } from './release-policy.mjs';

export const REQUIRED_ASSETS = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/SUPPORT.md',
  'extension/dist/extension.js',
  'extension/dist/webview.js',
  'extension/dist/webview.css',
  'extension/dist/THIRD_PARTY_LICENSES.txt',
  'extension/bridge/lhp_bridge.py',
  'extension/bridge/lhp_inspection.py',
  'extension/media/lhp-mark.svg',
  'extension/media/icon.png',
  'extension/media/activity.svg',
  'extension/media/tree-pipeline-dark.svg',
  'extension/media/tree-pipeline-light.svg',
  'extension/media/tree-flowgroup-dark.svg',
  'extension/media/tree-flowgroup-light.svg',
  'extension/LICENSE.txt',
  'extension/NOTICE',
  'extension/THIRD_PARTY_NOTICES.md',
];

const ALLOWED_ASSETS = new Set([
  ...REQUIRED_ASSETS,
  'extension/dist/NOTICE',
  'extension/media/icon.svg',
  'extension/media/welcome.md',
]);

export async function auditPackage(filename, { manifest, commit }) {
  assertSourceManifest(manifest);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid package source revision.');
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024)
    throw new Error('VSIX must be a regular file within the 5 MB budget.');
  const contents = new Map();
  const canonicalNames = new Set();
  let totalSize = 0;
  const archive = await new Promise((resolve, reject) =>
    yauzl.open(filename, { lazyEntries: true, strictFileNames: true }, (error, zip) =>
      error ? reject(error) : resolve(zip),
    ),
  );
  await new Promise((resolve, reject) => {
    const fail = (error) => {
      archive.close();
      reject(error);
    };
    archive.on('error', fail);
    archive.on('end', resolve);
    archive.on('entry', (entry) => {
      const name = entry.fileName;
      totalSize += entry.uncompressedSize;
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        canonicalNames.has(name.toLowerCase()) ||
        name.split('/').some((part) => !part || part === '.' || part === '..') ||
        name.startsWith('/') ||
        name.includes('\\') ||
        [...name].some((character) => character.charCodeAt(0) < 32) ||
        (mode !== 0 && mode !== 0x8000) ||
        entry.uncompressedSize > 8 * 1024 * 1024 ||
        totalSize > 20 * 1024 * 1024 ||
        contents.size >= 200
      )
        return fail(new Error(`Unsafe, duplicate or oversized packaged entry: ${name}`));
      canonicalNames.add(name.toLowerCase());
      if (!ALLOWED_ASSETS.has(name))
        return fail(new Error(`File outside package allowlist: ${name}`));
      archive.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', fail);
        stream.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          if (
            /\.(?:js|css|py|json|md|txt|svg|xml)$/.test(name) &&
            /\/Users\/|\/home\/node\/|npm-proxy\.dev\.databricks\.com|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/.test(
              text,
            )
          )
            return fail(new Error(`Local path/private material in ${name}`));
          contents.set(name, bytes);
          archive.readEntry();
        });
      });
    });
    archive.readEntry();
  });
  for (const name of REQUIRED_ASSETS)
    if (!contents.has(name)) throw new Error(`Missing packaged asset: ${name}`);
  const packagedManifest = JSON.parse(contents.get('extension/package.json').toString('utf8'));
  if (JSON.stringify(packagedManifest) !== JSON.stringify(manifest))
    throw new Error('Packaged package.json differs from the reviewed source manifest.');
  const xml = contents.get('extension.vsixmanifest').toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unexpected VSIX XML declaration.');
  const parsed = await parseStringPromise(xml);
  const metadata = parsed?.PackageManifest?.Metadata;
  const identities = metadata?.[0]?.Identity;
  if (
    metadata?.length !== 1 ||
    identities?.length !== 1 ||
    identities[0].$.Id !== manifest.name ||
    identities[0].$.Publisher !== manifest.publisher ||
    identities[0].$.Version !== manifest.version ||
    'TargetPlatform' in identities[0].$
  )
    throw new Error('VSIX identity/version is invalid or the package is not universal.');
  const preRelease = metadata[0].Properties?.flatMap((item) => item.Property ?? []).filter(
    (item) => item.$?.Id === 'Microsoft.VisualStudio.Code.PreRelease',
  );
  if (preRelease?.length !== 1 || preRelease[0].$.Value !== 'true')
    throw new Error('VSIX is not explicitly marked as a Marketplace pre-release.');
  if (!contents.get('extension/dist/extension.js').toString('utf8').includes(CORE_COMMIT))
    throw new Error('Packaged runtime does not contain the reviewed core revision.');
  for (const name of ['extension/readme.md', 'extension/changelog.md']) {
    const markdown = contents.get(name).toString('utf8');
    for (const match of markdown.matchAll(
      /https:\/\/github\.com\/Mmodarre\/lhp-vscode\/(?:blob|raw)\/([^/)\s]+)/g,
    ))
      if (match[1] !== commit) throw new Error(`Mutable or mismatched source link in ${name}`);
    if (markdown.includes(`https://github.com/${REPOSITORY}/blob/${commit}/.tmp/`))
      throw new Error('Packaged documentation links to private build artifacts.');
  }
  const bytes = await readFile(filename);
  return {
    files: contents.size,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
