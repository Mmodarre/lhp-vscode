import * as assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import { generateSavedProject } from '../../src/projectOperations';
import type { HostMessage, ProjectSnapshot } from '../../src/shared/protocol';

function ready(api: ExtensionApi): ProjectSnapshot {
  const snapshot = api.controller.snapshot;
  assert.ok(
    snapshot && snapshot.refreshState === 'ready' && !snapshot.stale,
    `Sandbox test needs a fresh graph: ${snapshot?.refreshState ?? 'missing'}, stale=${snapshot?.stale ?? 'n/a'}, diagnostics=${snapshot?.diagnostics.map((issue) => `${issue.code ?? 'unknown'}:${issue.source?.path ?? 'project'}`).join(', ') ?? 'none'}, dirty=${vscode.workspace.textDocuments
      .filter((document) => document.isDirty && document.uri.scheme === 'file')
      .map((document) => document.uri.fsPath)
      .join(', ')}`,
  );
  return snapshot;
}

function awaitSnapshot(
  api: ExtensionApi,
  projectId: string,
  matches: (snapshot: ProjectSnapshot) => boolean,
): Promise<ProjectSnapshot> {
  const host = api.controller;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.dispose();
      try {
        const current = ready(api);
        reject(
          new Error(
            `Sandbox snapshot did not reach the expected profile/source state: root=${host.project?.root}, interpreter=${current.context.runtime.interpreter}, sandbox=${JSON.stringify(current.sandbox)}, documents=${JSON.stringify(current.documents)}`,
          ),
        );
      } catch (error) {
        reject(error);
      }
    }, 15_000);
    const check = () => {
      const snapshot = host.snapshot;
      if (
        snapshot?.context.project.id !== projectId ||
        snapshot.refreshState !== 'ready' ||
        snapshot.stale ||
        !matches(snapshot)
      )
        return;
      clearTimeout(timeout);
      subscription.dispose();
      resolve(snapshot);
    };
    const subscription = host.onDidChangeState(check);
    check();
  });
}

/** Actual extension-host lifecycle in a dedicated nested test project. */
export async function runSandboxTests(api: ExtensionApi): Promise<void> {
  const host = api.controller;
  const original = host.readProject();
  const testRoot = path.join(original.root, 'sandbox-native-project');
  await mkdir(path.join(testRoot, 'pipelines'), { recursive: true });
  await mkdir(path.join(testRoot, 'config'), { recursive: true });
  await mkdir(path.join(testRoot, '.lhp'), { recursive: true });
  await writeFile(path.join(testRoot, 'lhp.yaml'), 'name: sandbox_native_test\nversion: "1.0"\n');
  await writeFile(
    path.join(testRoot, 'databricks.yml'),
    'bundle:\n  name: sandbox_native_test\ninclude:\n  - resources/lhp/*.yml\ntargets:\n  dev:\n    mode: development\n    default: true\n',
  );
  await writeFile(
    path.join(testRoot, 'config/pipeline_config.yaml'),
    'project_defaults:\n  serverless: true\n  channel: CURRENT\n  catalog: main\n  schema: bronze\n',
  );
  const pipeline = (name: string) =>
    `pipeline: ${name}\nflowgroup: ${name}_group\nactions:\n  - name: load_${name}\n    type: load\n    source:\n      type: cloudfiles\n      path: /Volumes/main/landing/${name}/*.json\n      format: json\n    target: v_${name}\n  - name: write_${name}\n    type: write\n    source: v_${name}\n    write_target:\n      type: streaming_table\n      catalog: main\n      schema: bronze\n      table: ${name}\n`;
  await writeFile(path.join(testRoot, 'pipelines/bronze.yaml'), pipeline('bronze'));
  await writeFile(path.join(testRoot, 'pipelines/sandbox_other.yaml'), pipeline('sandbox_other'));
  await writeFile(
    path.join(testRoot, '.lhp/profile.yaml'),
    'sandbox:\n  namespace: seed\n  pipelines: [bronze, sandbox_other]\n',
  );
  try {
    await host.discover();
    const project = host.projects.find((candidate) => candidate.root === testRoot);
    assert.ok(project, `nested sandbox test project discovered: ${testRoot}`);
    await host.selectProject(project.summary.id);
    const initial = ready(api);
    assert.equal(host.project?.root, testRoot, 'sandbox suite owns its selected project');
    if (!initial.context.runtime.capabilities.includes('sandbox_editor')) {
      await assert.rejects(host.setSandboxMode('on'), /sandbox editing|compatible/i);
      return;
    }
    assert.equal(
      initial.sandbox?.profileExists,
      true,
      `saved fixture profile is indexed: root=${host.project?.root}, interpreter=${initial.context.runtime.interpreter}, sandbox=${JSON.stringify(initial.sandbox)}`,
    );
    const root = vscode.Uri.file(testRoot);
    const profileUri = vscode.Uri.joinPath(root, '.lhp/profile.yaml');
    const otherUri = vscode.Uri.joinPath(root, 'pipelines/sandbox_other.yaml');
    const profile = await vscode.workspace.openTextDocument(profileUri);
    console.log('[sandbox] saved profile indexed');
    await host.setSandboxMode('on');
    console.log('[sandbox] mode enabled');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      profileUri,
      new vscode.Range(profile.positionAt(0), profile.positionAt(profile.getText().length)),
      'sandbox:\n  namespace: alice\n  pipelines: [bronze]\n',
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(profile.isDirty, 'profile remains an unsaved native TextDocument');
    await host.refresh();
    await awaitSnapshot(
      api,
      project.summary.id,
      (value) => value.sandbox?.profileSource === 'draft' && value.sandbox.namespace === 'alice',
    );
    console.log('[sandbox] draft profile inspected');
    let snapshot = ready(api);
    assert.equal(snapshot.sandbox?.profileSource, 'draft');
    assert.equal(snapshot.sandbox?.namespace, 'alice');
    assert.deepEqual(snapshot.sandbox?.selectedPipelines, ['bronze']);
    assert.ok(
      snapshot.pipelines.some((pipeline) => pipeline.name === 'sandbox_other'),
      'full authored graph remains available',
    );
    assert.deepEqual(
      api.sidebar.model
        .roots('pipelines')
        .filter((row) => row.kind === 'pipeline')
        .map((row) => row.label),
      ['bronze'],
    );
    const scope = host.sandboxIdentity;
    await host.setPipelineDisplay('all');
    assert.equal(host.sandboxIdentity, scope, 'Show all is display only');
    assert.ok(
      api.sidebar.model
        .roots('pipelines')
        .some((row) => row.kind === 'pipeline' && row.label === 'sandbox_other'),
    );
    snapshot = ready(api);
    const other = snapshot.flowgroups.find((group) => group.pipeline === 'sandbox_other')
      ?.actions[0];
    assert.ok(other?.editable);
    await host.receive({
      type: 'mutate',
      requestId: 'sandbox-outside-scope',
      context: { projectId: project.summary.id, revision: snapshot.revision },
      projectId: project.summary.id,
      documentVersions: Object.fromEntries(
        snapshot.documents.map((document) => [document.path, document.version]),
      ),
      mutation: {
        kind: 'configure',
        actionId: other.id,
        values: { ...other.raw, description: 'edited while Show all' },
      },
    });
    const otherDocument = await vscode.workspace.openTextDocument(otherUri);
    assert.ok(
      otherDocument.isDirty,
      'out-of-scope canonical source still uses native undoable edit',
    );
    assert.match(otherDocument.getText(), /edited while Show all/);
    await host.refresh();
    await awaitSnapshot(
      api,
      project.summary.id,
      (value) =>
        value.sandbox?.profileSource === 'draft' &&
        value.flowgroups
          .find((group) => group.pipeline === 'sandbox_other')
          ?.actions.some((action) => action.raw.description === 'edited while Show all') === true,
    );
    assert.equal(ready(api).sandbox?.profileSource, 'draft');
    console.log('[sandbox] out-of-scope native edit inspected');
    await host.setPipelineDisplay('selected');
    const messages: HostMessage[] = [];
    const post = host.panel.post.bind(host.panel);
    host.panel.post = (message) => {
      messages.push(message);
      post(message);
    };
    try {
      await host.operate('preview');
    } finally {
      host.panel.post = post;
    }
    const preview = messages.find((message) => message.type === 'preview');
    console.log('[sandbox] scoped preview completed');
    assert.ok(preview && preview.type === 'preview');
    assert.equal(preview.result.mode, 'on');
    assert.equal(preview.result.namespace, 'alice');
    assert.equal(preview.result.scopeIdentity, scope);
    assert.ok(preview.result.files.every((file) => !file.pipeline || file.pipeline === 'bronze'));
    await assert.rejects(generateSavedProject(host), /Save .lhp\/profile.yaml/);
    assert.ok(await profile.save());
    assert.ok(await otherDocument.save());
    await host.refresh();
    await awaitSnapshot(
      api,
      project.summary.id,
      (value) => value.sandbox?.profileSource === 'saved' && value.sandbox.namespace === 'alice',
    );
    assert.equal(ready(api).sandbox?.profileSource, 'saved');
    console.log('[sandbox] profile saved');
    await generateSavedProject(host);
    console.log('[sandbox] scoped generation completed');
    assert.match(
      host.sandboxView?.generatedOutputScope ?? '',
      /Last generated by extension: Sandbox alice/,
    );
  } finally {
    if (host.project?.root === testRoot) {
      await host.setPipelineDisplay('selected');
      if (host.sandboxMode === 'on') await host.setSandboxMode('off');
      await host.selectProject(original.summary.id);
    }
    await rm(testRoot, { recursive: true, force: true });
    await host.discover();
  }
}
