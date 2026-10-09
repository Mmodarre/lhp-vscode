import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as yauzl from 'yauzl';
import { auditPackage } from './package-audit.mjs';
import {
  assertCiRun,
  assertProvenance,
  assertReleaseContext,
  REPOSITORY,
  releaseNames,
} from './release-policy.mjs';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tag = process.env.RELEASE_TAG;
const runId = process.env.RELEASE_CI_RUN_ID;
assertReleaseContext({
  ref: process.env.GITHUB_REF,
  event: process.env.GITHUB_EVENT_NAME,
  repository: process.env.GITHUB_REPOSITORY,
  tag,
  commit,
  version: manifest.version,
});
if (process.env.GITHUB_SHA !== commit) throw new Error('Checkout differs from workflow source.');
if (!/^[1-9]\d*$/.test(runId ?? '') || !Number.isSafeInteger(Number(runId)))
  throw new Error('A numeric CI run ID is required.');
if (!process.env.GH_TOKEN) throw new Error('A read-only GitHub Actions token is required.');

async function api(endpoint) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub metadata request failed (${response.status}).`);
  return response.json();
}
async function pages(endpoint, key) {
  const values = [];
  for (let page = 1; page <= 10; page++) {
    const result = await api(`${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(result[key])) throw new Error('Invalid GitHub collection response.');
    values.push(...result[key]);
    if (result[key].length < 100) return values;
  }
  throw new Error('GitHub collection exceeds release metadata limit.');
}
const run = await api(`actions/runs/${runId}`);
const jobs = await pages(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs');
const artifacts = await pages(`actions/runs/${runId}/artifacts`, 'artifacts');
const names = releaseNames(manifest.version);
const matches = artifacts.filter((artifact) => artifact.name === names.artifact);
if (matches.length !== 1) throw new Error('Expected exactly one canonical CI artifact.');
const artifact = matches[0];
assertCiRun({ run, jobs, artifact, commit, version: manifest.version });
let reference = (await api(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
for (let depth = 0; reference.type === 'tag' && depth < 4; depth++)
  reference = (await api(`git/tags/${reference.sha}`)).object;
if (reference.type !== 'commit' || reference.sha !== commit)
  throw new Error('Existing release tag must point to the same current main CI source.');
if ((await api('git/ref/heads/main')).object.sha !== commit)
  throw new Error('Main has moved; review the new source before preparing a release.');

if (process.argv[2] === 'download') {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  );
  const location = response.headers.get('location');
  if (response.status !== 302 || !location || new URL(location).protocol !== 'https:')
    throw new Error('GitHub did not return a secure artifact download.');
  // The signed storage URL receives no GitHub token.
  const download = await fetch(location, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!download.ok) throw new Error(`Artifact download failed (${download.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of download.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Release artifact exceeds the download budget.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest)
    throw new Error('Downloaded GitHub artifact digest does not match the CI record.');
  await mkdir('.tmp/release', { recursive: true });
  const expected = new Set([names.vsix, names.checksum, names.provenance]);
  const archive = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true }, (error, zip) =>
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
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        !expected.delete(entry.fileName) ||
        entry.uncompressedSize > 5 * 1024 * 1024 ||
        (mode !== 0 && mode !== 0x8000)
      )
        return fail(new Error('Unexpected, duplicate or unsafe release artifact entry.'));
      archive.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', fail);
        stream.on('end', () => {
          writeFile(`.tmp/release/${entry.fileName}`, Buffer.concat(chunks), { flag: 'wx' }).then(
            () => archive.readEntry(),
            fail,
          );
        });
      });
    });
    archive.readEntry();
  });
  if (expected.size) throw new Error('The release artifact is missing required files.');
  const audited = await auditPackage(`.tmp/release/${names.vsix}`, { manifest, commit });
  const provenance = JSON.parse(await readFile(`.tmp/release/${names.provenance}`, 'utf8'));
  assertProvenance(provenance, { commit, version: manifest.version, run, ...audited });
  if (
    (await readFile(`.tmp/release/${names.checksum}`, 'utf8')) !==
    `${audited.sha256}  ${names.vsix}\n`
  )
    throw new Error('The release checksum sidecar does not match the VSIX.');
  console.log(`Verified exact CI VSIX ${names.vsix}; SHA256 ${audited.sha256}`);
  await writeFile(
    '.tmp/release-notes.md',
    [
      `Lakehouse Plumber ${manifest.version} pre-release`,
      '',
      'This universal VSIX passed Linux, macOS and Windows CI. Marketplace upload is a separate manual step.',
      '',
      `Source: https://github.com/${REPOSITORY}/commit/${commit}`,
      `CI: https://github.com/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
      `SHA256: \`${audited.sha256}\``,
      '',
      `Install: download \`${names.vsix}\` and use **Extensions: Install from VSIX…** in desktop VS Code.`,
      'Python 3.11+ is required. Use **LHP: Set Up Python Environment** to install the reviewed compatible LHP build.',
      '',
      'This release does not deploy or run Databricks workloads.',
      '',
    ].join('\n'),
  );
} else if (process.argv[2] !== 'verify') {
  throw new Error('Use prepare-release.mjs verify or download.');
}
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${manifest.version}\nartifact_id=${artifact.id}\n`,
  );
console.log(`Verified ${tag} at ${commit} against CI ${run.id}, attempt ${run.run_attempt}.`);
