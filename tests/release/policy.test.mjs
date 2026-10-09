import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCiRun,
  assertProvenance,
  assertReleaseContext,
  assertReleaseVersion,
  CORE_COMMIT,
  REPOSITORY,
  REQUIRED_JOBS,
} from '../../scripts/release-policy.mjs';

const commit = 'a'.repeat(40);
const sha256 = 'b'.repeat(64);
const version = '0.3.1';
const context = {
  ref: 'refs/heads/main',
  event: 'workflow_dispatch',
  repository: REPOSITORY,
  tag: 'v0.3.1',
  commit,
  version,
};
const run = {
  id: 123,
  run_attempt: 2,
  repository: { full_name: REPOSITORY },
  head_repository: { full_name: REPOSITORY },
  event: 'push',
  head_branch: 'main',
  path: '.github/workflows/ci.yml',
  head_sha: commit,
  status: 'completed',
  conclusion: 'success',
};
const jobs = REQUIRED_JOBS.map((name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
  head_sha: commit,
  run_id: run.id,
  run_attempt: run.run_attempt,
}));
const artifact = {
  id: 456,
  name: 'lhp-vscode-0.3.1',
  expired: false,
  workflow_run: { id: run.id, head_sha: commit },
  digest: `sha256:${sha256}`,
};
const provenance = {
  schemaVersion: 1,
  repository: REPOSITORY,
  sourceCommit: commit,
  sourceDirty: false,
  name: 'lhp-vscode',
  publisher: 'MEHDIMODARRESSI',
  version,
  preRelease: true,
  target: 'universal',
  coreCommit: CORE_COMMIT,
  sha256,
  bytes: 100,
  ci: {
    runId: run.id,
    runAttempt: run.run_attempt,
    workflow: `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/main`,
  },
};

test('accepts the exact main dispatch, successful attempt and audited pre-release provenance', () => {
  assertReleaseContext(context);
  assertCiRun({ run, jobs, artifact, commit, version });
  assertProvenance(provenance, { commit, version, sha256, bytes: 100, run });
});
for (const version of ['0.3.1-beta.1', '0.4.0', '01.3.1', '0.3', 'v0.3.1'])
  test(`rejects non-pre-release-channel version ${version}`, () =>
    assert.throws(() => assertReleaseVersion(version)));
for (const change of [
  { ref: 'refs/heads/feature/initial-extension' },
  { event: 'pull_request' },
  { repository: 'fork/lhp-vscode' },
  { tag: 'v0.3.0' },
  { commit: 'short' },
])
  test(`rejects release context ${JSON.stringify(change)}`, () =>
    assert.throws(() => assertReleaseContext({ ...context, ...change })));
for (const change of [
  { event: 'pull_request' },
  { head_branch: 'feature/initial-extension' },
  { head_sha: 'c'.repeat(40) },
  { path: '.github/workflows/other.yml' },
  { repository: { full_name: 'fork/lhp-vscode' } },
  { head_repository: { full_name: 'fork/lhp-vscode' } },
  { conclusion: 'failure' },
  { status: 'in_progress' },
  { run_attempt: 0 },
])
  test(`rejects CI source/status ${JSON.stringify(change)}`, () =>
    assert.throws(() =>
      assertCiRun({ run: { ...run, ...change }, jobs, artifact, commit, version }),
    ));
for (const change of [
  { conclusion: 'skipped' },
  { conclusion: 'failure' },
  { run_attempt: 1 },
  { head_sha: 'c'.repeat(40) },
  { run_id: 999 },
])
  test(`rejects a platform job ${JSON.stringify(change)}`, () => {
    const changed = jobs.map((job, index) => (index === 1 ? { ...job, ...change } : job));
    assert.throws(() => assertCiRun({ run, jobs: changed, artifact, commit, version }));
  });
test('requires every platform and package exactly once', () => {
  assert.throws(() => assertCiRun({ run, jobs: jobs.slice(1), artifact, commit, version }));
  assert.throws(() => assertCiRun({ run, jobs: [...jobs, jobs[0]], artifact, commit, version }));
});
for (const change of [
  { name: 'other' },
  { expired: true },
  { workflow_run: { id: 999, head_sha: commit } },
  { digest: null },
])
  test(`rejects artifact metadata ${JSON.stringify(change)}`, () =>
    assert.throws(() =>
      assertCiRun({ run, jobs, artifact: { ...artifact, ...change }, commit, version }),
    ));
for (const change of [
  { sourceDirty: true },
  { sourceCommit: 'c'.repeat(40) },
  { sha256: 'c'.repeat(64) },
  { publisher: 'Mmodarre' },
  { name: 'another-extension' },
  { preRelease: false },
  { target: 'linux-x64' },
  { coreCommit: 'c'.repeat(40) },
  { version: '0.3.0' },
  { bytes: 101 },
  { ci: { ...provenance.ci, runAttempt: 1 } },
  {
    ci: {
      ...provenance.ci,
      workflow: `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/feature/initial-extension`,
    },
  },
])
  test(`rejects provenance ${JSON.stringify(change)}`, () =>
    assert.throws(() =>
      assertProvenance({ ...provenance, ...change }, { commit, version, sha256, bytes: 100, run }),
    ));
