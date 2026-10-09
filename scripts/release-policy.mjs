export const REPOSITORY = 'Mmodarre/lhp-vscode';
export const CORE_COMMIT = '4a53d72a96c386a12ff237fc0105a31266007f39';
export const REQUIRED_JOBS = [
  'verify (ubuntu-latest)',
  'verify (macos-latest)',
  'verify (windows-latest)',
  'package',
];

export function assertReleaseVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Marketplace versions must use numeric major.minor.patch.');
  if (Number(version.split('.')[1]) % 2 !== 1)
    throw new Error('This pre-release workflow requires an odd minor version.');
}

export function assertSourceManifest(manifest) {
  assertReleaseVersion(manifest.version);
  if (manifest.name !== 'lhp-vscode' || manifest.publisher !== 'MEHDIMODARRESSI')
    throw new Error('Unexpected extension or publisher identity.');
  if (manifest.icon !== 'media/icon.png' || manifest.main !== './dist/extension.js')
    throw new Error('Unexpected extension entry point or original icon.');
}

export function releaseNames(version) {
  assertReleaseVersion(version);
  const base = `lhp-vscode-${version}`;
  return {
    artifact: base,
    vsix: `${base}.vsix`,
    checksum: `${base}.vsix.sha256`,
    provenance: `${base}.provenance.json`,
  };
}

export function assertReleaseContext({ ref, event, repository, tag, commit, version }) {
  assertReleaseVersion(version);
  if (ref !== 'refs/heads/main' || event !== 'workflow_dispatch' || repository !== REPOSITORY)
    throw new Error('Release preparation must be dispatched from this repository main branch.');
  if (!/^[a-f0-9]{40}$/.test(commit) || tag !== `v${version}`)
    throw new Error('Release tag/version/source mismatch.');
}

export function assertCiRun({ run, jobs, artifact, commit, version }) {
  if (
    run.repository?.full_name !== REPOSITORY ||
    run.head_repository?.full_name !== REPOSITORY ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.head_sha !== commit ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1
  )
    throw new Error('A completed successful main push CI run at the release source is required.');
  for (const name of REQUIRED_JOBS) {
    const matches = jobs.filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      matches[0].status !== 'completed' ||
      matches[0].conclusion !== 'success' ||
      matches[0].head_sha !== commit ||
      matches[0].run_id !== run.id ||
      matches[0].run_attempt !== run.run_attempt
    )
      throw new Error(`Required CI job did not pass in this attempt: ${name}`);
  }
  if (
    artifact.name !== releaseNames(version).artifact ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== commit ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
  )
    throw new Error('CI artifact identity, source or digest is invalid.');
}

export function assertProvenance(provenance, { commit, version, sha256, bytes, run }) {
  if (
    provenance.schemaVersion !== 1 ||
    provenance.repository !== REPOSITORY ||
    provenance.sourceCommit !== commit ||
    provenance.sourceDirty !== false ||
    provenance.name !== 'lhp-vscode' ||
    provenance.publisher !== 'MEHDIMODARRESSI' ||
    provenance.version !== version ||
    provenance.preRelease !== true ||
    provenance.target !== 'universal' ||
    provenance.coreCommit !== CORE_COMMIT ||
    provenance.sha256 !== sha256 ||
    provenance.bytes !== bytes
  )
    throw new Error('VSIX provenance does not match this clean source and package.');
  if (
    run &&
    (provenance.ci?.runId !== run.id ||
      provenance.ci?.runAttempt !== run.run_attempt ||
      provenance.ci?.workflow !== `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/main`)
  )
    throw new Error('VSIX provenance was not produced by the selected main CI attempt.');
}
