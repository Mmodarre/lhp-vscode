import { execFileSync } from 'node:child_process';
import { createVSIX } from '@vscode/vsce';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { auditPackage } from './package-audit.mjs';
import { assertSourceManifest, CORE_COMMIT, REPOSITORY, releaseNames } from './release-policy.mjs';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assertSourceManifest(manifest);
const names = releaseNames(manifest.version);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error('A committed source revision is required for packaging.');
const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
  encoding: 'utf8',
}).trim();
if (sourceDirty && !process.argv.includes('--allow-dirty'))
  throw new Error(
    'Commit the reviewed source before packaging, or use --allow-dirty for development only.',
  );
await mkdir('.tmp', { recursive: true });
const filename = `.tmp/${names.vsix}`;
await createVSIX({
  packagePath: filename,
  dependencies: false,
  preRelease: true,
  baseContentUrl: `https://github.com/${REPOSITORY}/blob/${commit}`,
  baseImagesUrl: `https://github.com/${REPOSITORY}/raw/${commit}`,
});
const audited = await auditPackage(filename, { manifest, commit });
const provenance = {
  schemaVersion: 1,
  repository: REPOSITORY,
  sourceCommit: commit,
  sourceDirty,
  name: manifest.name,
  publisher: manifest.publisher,
  version: manifest.version,
  preRelease: true,
  target: 'universal',
  coreCommit: CORE_COMMIT,
  sha256: audited.sha256,
  bytes: audited.bytes,
  ci:
    process.env.GITHUB_ACTIONS === 'true'
      ? {
          runId: Number(process.env.GITHUB_RUN_ID),
          runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
          workflow: process.env.GITHUB_WORKFLOW_REF,
        }
      : null,
};
await writeFile(`.tmp/${names.provenance}`, `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(`.tmp/${names.checksum}`, `${audited.sha256}  ${names.vsix}\n`);
console.log(
  `Packaged pre-release ${manifest.version}; SHA256 ${audited.sha256}${sourceDirty ? ' (development: dirty source)' : ''}`,
);
