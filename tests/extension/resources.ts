import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';
import { createFlowgroup } from '../../src/projectOperations';

/** Real native API integration, no UI driver and no core E2E fixture changes. */
export async function runResourceTests(api: ExtensionApi): Promise<void> {
  const host = api.controller;
  await host.refreshResources();
  const resource = (filename: string) => {
    const item = host.resourceIndex?.files.find((entry) => entry.path === filename);
    assert.ok(item, `physical resource indexed: ${filename}`);
    return item;
  };
  const oldRuntime = host.workspace.runtime;
  try {
    host.workspace.runtime = {
      interpreter: 'unavailable',
      compatible: false,
      capabilities: [],
      message: 'Synthetic unavailable runtime',
    };
    await host.openResource(resource('templates/reader.yaml').id);
    assert.ok(
      vscode.window.visibleTextEditors.some((editor) =>
        editor.document.uri.path.endsWith('/templates/reader.yaml'),
      ),
      'native browse does not require a working interpreter',
    );
  } finally {
    host.workspace.runtime = oldRuntime;
  }
  await host.inspectResource({
    kind: 'template',
    resourceId: resource('templates/reader.yaml').id,
    stage: 'inspect',
  });
  assert.ok(
    vscode.workspace.textDocuments.some(
      (document) =>
        document.uri.scheme === 'lhp-inspection' && document.getText().includes('template: reader'),
    ),
    'template inspection opens read-only native provider',
  );
  await host.inspectResource({
    kind: 'pipelineConfig',
    resourceId: resource('config/pipeline_config.yaml').id,
  });
  assert.ok(
    vscode.workspace.textDocuments.some(
      (document) =>
        document.uri.scheme === 'lhp-inspection' && document.getText().includes('Saved files only'),
    ),
    'effective configuration states saved-only boundary',
  );
  await host.inspectResource({ kind: 'preset', resourceId: resource('presets/common.yaml').id });
  assert.ok(
    vscode.workspace.textDocuments.some(
      (document) =>
        document.uri.scheme === 'lhp-inspection' && document.getText().includes('merged_config'),
    ),
    'preset resolver result reached native provider',
  );
  await host.loadData();
  assert.ok(host.datasets?.datasets.some((entry) => entry.name === 'main.bronze.orders'));
  assert.ok(
    host.datasets?.datasets.find((entry) => entry.name === 'main.bronze.orders')?.producers[0]
      ?.source?.path === 'pipelines/orders.yaml',
    'dataset provenance resolves exact authoring source',
  );

  // Seed a preview using the public provider, then reject a persisted other-env
  // file even when its plan-relative path is identical.
  host.previews.set({
    files: [{ path: 'orders.py', content: '# draft', kind: 'source' }],
    parity: 'source-only',
    documentVersions: {},
    notices: [],
  });
  const saved = host.workspace.index!;
  host.workspace.index = {
    ...saved,
    files: [
      ...saved.files,
      {
        id: 'foreign-output',
        path: 'generated/prod/orders.py',
        name: 'orders.py',
        source: { path: 'generated/prod/orders.py' },
        kind: 'generated',
        generatedKind: 'source',
        environment: 'prod',
        exists: true,
        registered: false,
        consumers: [],
      },
    ],
  };
  try {
    await assert.rejects(
      host.compareGenerated('foreign-output'),
      /another environment|active preview environment/,
    );
  } finally {
    host.workspace.index = saved;
    host.previews.clear();
  }
}

export async function runResourceGenerationTests(api: ExtensionApi): Promise<void> {
  const host = api.controller;
  await host.refreshResources();
  const generated = host.resourceIndex?.files.find(
    (resource) => resource.kind === 'generated' && resource.path.endsWith('/orders.py'),
  );
  assert.ok(generated, 'real generated source indexed after full generation');
  assert.equal(
    generated.authoringSources?.length,
    1,
    'exact generated flowgroup provenance, not all pipeline sources',
  );
  assert.equal(generated.authoringSources?.[0]?.source.path, 'pipelines/orders.yaml');
  await host.findAuthoringSource(generated.id);
  assert.ok(
    vscode.window.visibleTextEditors.some((editor) =>
      editor.document.uri.path.endsWith('/pipelines/orders.yaml'),
    ),
  );
  await host.operate('preview');
  await host.compareGenerated(generated.id);
  assert.ok(
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.modified.scheme === 'lhp-preview',
      ),
    'native generated-to-draft diff opened',
  );

  await createFlowgroup(host, {
    name: 'guided_draft',
    pipeline: 'guided',
    targetPath: 'pipelines/guided/new.yaml',
  });
  const group = host.snapshot?.flowgroups.find((flowgroup) => flowgroup.name === 'guided_draft');
  assert.ok(group?.editable, 'new empty flowgroup is available for guided action edits');
  assert.equal(
    host.snapshot?.stale,
    false,
    'incomplete configuration is distinct from invalid YAML',
  );
  const uri = vscode.Uri.file(host.readProject().root + '/pipelines/guided/new.yaml');
  const document = await vscode.workspace.openTextDocument(uri);
  assert.ok(document.getText().includes('actions: []'));
  assert.ok(document.isDirty, 'new flowgroup uses native unsaved document state');
  await assert.rejects(
    createFlowgroup(host, {
      name: 'must_not_replace',
      pipeline: 'guided',
      targetPath: 'pipelines/orders.yaml',
    }),
    /already exist|new YAML path/,
  );
  await document.save();
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.workspace.fs.delete(uri);
  clearTimeout(host.timer);
  await host.refresh();
}
