import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { auditPackage } from './package-audit.mjs';
import { assertProvenance, releaseNames } from './release-policy.mjs';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const names = releaseNames(manifest.version);
const directory = process.argv[2] ?? '.tmp';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const audited = await auditPackage(path.join(directory, names.vsix), { manifest, commit });
const provenance = JSON.parse(await readFile(path.join(directory, names.provenance), 'utf8'));
assertProvenance(provenance, { commit, version: manifest.version, ...audited });
const checksum = await readFile(path.join(directory, names.checksum), 'utf8');
if (checksum !== `${audited.sha256}  ${names.vsix}\n`)
  throw new Error('VSIX checksum sidecar does not match the artifact.');
console.log(`Audited ${audited.files} files; ${audited.bytes} bytes; SHA256 ${audited.sha256}`);
