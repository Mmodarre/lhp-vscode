import * as assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../src/extension';

async function completions(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
  const result = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    position,
  );
  return result?.items ?? [];
}
function label(item: vscode.CompletionItem): string {
  return typeof item.label === 'string' ? item.label : item.label.label;
}
function locationUri(value: vscode.Location | vscode.LocationLink): vscode.Uri {
  return 'uri' in value ? value.uri : value.targetUri;
}

/** Exercises registered VS Code providers, native edits and the real YAML extension. */
export async function runLanguageTests(api: ExtensionApi): Promise<void> {
  const project = api.controller.readProject();
  const sql = path.join(project.root, 'sql/extension_assist.sql');
  const authoring = path.join(project.root, 'pipelines/extension_assist.yaml');
  const snippetFile = path.join(project.root, 'pipelines/extension_snippet.yaml');
  const invalid = path.join(project.root, 'pipelines/extension_invalid.yaml');
  const devSubstitutions = path.join(project.root, 'substitutions/dev.yaml');
  const prodSubstitutions = path.join(project.root, 'substitutions/prod.yaml');
  await mkdir(path.dirname(sql), { recursive: true });
  await mkdir(path.dirname(devSubstitutions), { recursive: true });
  await writeFile(sql, 'SELECT 1 AS example\n');
  await writeFile(
    authoring,
    [
      'pipeline: bronze',
      'flowgroup: extension_assist',
      'actions:',
      '  - name: clean_assist',
      '    type: transform',
      '    transform_type: sql',
      '    source: v_orders',
      '    sql_path: ./sql/extension_assist.sql',
      '',
    ].join('\n'),
  );
  await writeFile(devSubstitutions, 'dev:\n  dev_catalog: main\n');
  await writeFile(prodSubstitutions, 'prod:\n  prod_catalog: main\n');
  try {
    await api.controller.refreshResources();
    await api.controller.refresh();
    const uri = vscode.Uri.file(authoring);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const sourceLine = 6;
    for (const [environment, expected, excluded] of [
      ['dev', 'dev_catalog', 'prod_catalog'],
      ['prod', 'prod_catalog', 'dev_catalog'],
    ] as const) {
      await api.controller.selectEnvironment(environment);
      assert.equal(api.controller.environment(project), environment);
      await editor.edit((edit) =>
        edit.replace(
          document.lineAt(sourceLine).range,
          `    source: \${${environment.slice(0, 4)}_}`,
        ),
      );
      const tokenColumn = document.lineAt(sourceLine).text.indexOf('}');
      const tokenItems = await completions(uri, new vscode.Position(sourceLine, tokenColumn));
      assert.ok(
        tokenItems.some((item) => label(item) === expected),
        `${environment} substitution is offered after switching environments`,
      );
      assert.ok(
        !tokenItems.some((item) => label(item) === excluded),
        'tokens from the other environment do not leak into completion',
      );
      await editor.edit((edit) =>
        edit.replace(document.lineAt(sourceLine).range, '    source: v_orders'),
      );
    }
    await api.controller.selectEnvironment('dev');
    await writeFile(
      snippetFile,
      'pipeline: bronze\nflowgroup: extension_snippet\nactions:\n  - \n',
    );
    await writeFile(
      invalid,
      'pipeline: bronze\nflowgroup: invalid_assist\nactions:\n  - name: bad\n    type: magical\n',
    );
    await api.controller.refreshResources();
    const line = 7;
    const value = './sql/extension_assist.sql';
    const position = new vscode.Position(line, document.lineAt(line).text.length);
    const suggestions = await completions(uri, position);
    const sqlSuggestion = suggestions.find((item) => label(item) === 'sql/extension_assist.sql');
    assert.ok(sqlSuggestion, 'indexed SQL path is offered by the real VS Code completion provider');
    assert.ok(
      sqlSuggestion.range instanceof vscode.Range,
      'path completion owns the whole scalar range',
    );
    await editor.edit((edit) =>
      edit.replace(sqlSuggestion.range as vscode.Range, label(sqlSuggestion)),
    );
    assert.equal(document.lineAt(line).text, '    sql_path: sql/extension_assist.sql');
    await vscode.commands.executeCommand('undo');
    assert.equal(document.lineAt(line).text, `    sql_path: ${value}`);

    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
      'vscode.executeCodeActionProvider',
      uri,
      new vscode.Range(line, 18, line, 18),
    );
    const fix = actions?.find((action) => action.title === 'Use project-relative resource path') as
      | vscode.CodeAction
      | undefined;
    assert.ok(fix?.command, 'deterministic quick fix is registered for a known contained resource');
    await vscode.commands.executeCommand(fix.command.command, ...(fix.command.arguments ?? []));
    assert.equal(document.lineAt(line).text, '    sql_path: sql/extension_assist.sql');
    await assert.rejects(
      Promise.resolve(
        vscode.commands.executeCommand(fix.command.command, ...(fix.command.arguments ?? [])),
      ),
      /changed|Recompute/i,
      'quick fix cannot replay against a newer TextDocument version',
    );

    const location = new vscode.Position(line, document.lineAt(line).text.length - 4);
    const targets = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      uri,
      location,
    );
    assert.ok(
      targets?.some((target) => locationUri(target).fsPath === sql),
      'definition uses the exact project-relative SQL source path',
    );
    const fieldPosition = new vscode.Position(line, 8);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      fieldPosition,
    );
    assert.ok(hovers?.length, 'native YAML field hover is provided');

    const snippetUri = vscode.Uri.file(snippetFile);
    const snippetDoc = await vscode.workspace.openTextDocument(snippetUri);
    const snippetEditor = await vscode.window.showTextDocument(snippetDoc);
    const snippetPosition = new vscode.Position(3, 4);
    const snippets = await completions(snippetUri, snippetPosition);
    const actionSnippet = snippets.find(
      (item) =>
        item.kind === vscode.CompletionItemKind.Snippet &&
        item.insertText instanceof vscode.SnippetString,
    );
    assert.ok(
      actionSnippet?.insertText instanceof vscode.SnippetString,
      'installed action catalogue drives native snippets',
    );
    await snippetEditor.insertSnippet(actionSnippet.insertText, snippetPosition);
    assert.match(snippetDoc.getText(), /actions:\n {2}- name:/);
    assert.doesNotMatch(snippetDoc.getText(), /- - name:/);

    const blueprintUri = vscode.Uri.file(path.join(project.root, 'pipelines/blueprint.yaml'));
    const blueprintDoc = await vscode.workspace.openTextDocument(blueprintUri);
    const parameterLine = blueprintDoc
      .getText()
      .split('\n')
      .findIndex((text) => text.includes('site_name:'));
    assert.ok(parameterLine >= 0);
    const parameterItems = await completions(blueprintUri, new vscode.Position(parameterLine, 5));
    assert.ok(
      parameterItems.some((item) => label(item) === 'site_name'),
      'selected blueprint contributes its own parameter keys',
    );

    const schemaUri = api.languages.schemaFor(vscode.Uri.file(invalid).toString());
    assert.ok(
      schemaUri.startsWith('lhp-schema:'),
      'runtime schema is associated with LHP authoring file',
    );
    await vscode.workspace
      .openTextDocument(vscode.Uri.file(invalid))
      .then((value) => vscode.window.showTextDocument(value));
    const deadline = Date.now() + 15_000;
    let diagnostics: readonly vscode.Diagnostic[] = [];
    while (Date.now() < deadline) {
      diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(invalid));
      if (diagnostics.some((entry) => entry.severity === vscode.DiagnosticSeverity.Error)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(
      diagnostics.some((entry) => entry.severity === vscode.DiagnosticSeverity.Error),
      'Red Hat YAML reports invalid action type from the runtime-associated schema',
    );
    const catalog = api.controller.catalog;
    assert.ok(catalog, 'compatible runtime supplied editor catalogue');
    api.languages.clearCatalog(project.root);
    assert.equal(
      api.languages.schemaFor(vscode.Uri.file(invalid).toString()),
      '',
      'stale schema is removed on runtime cache invalidation',
    );
    api.languages.updateCatalog(project.root, catalog);
    assert.ok(
      api.languages.schemaFor(vscode.Uri.file(invalid).toString()).startsWith('lhp-schema:'),
      'same open document regains a runtime schema after catalogue refresh',
    );
  } finally {
    // These editor actions leave native drafts open. Save them before removing
    // the fixture paths so the next snapshot cannot overlay deleted YAML.
    for (const document of vscode.workspace.textDocuments.filter(
      (entry) => entry.isDirty && [authoring, snippetFile].includes(entry.uri.fsPath),
    ))
      assert.ok(await document.save(), `saved language test draft: ${document.uri.fsPath}`);
    await rm(sql, { force: true });
    await rm(authoring, { force: true });
    await rm(snippetFile, { force: true });
    await rm(invalid, { force: true });
    await rm(devSubstitutions, { force: true });
    await rm(prodSubstitutions, { force: true });
    await api.controller.selectEnvironment('dev');
    await api.controller.refreshResources();
    await api.controller.refresh();
  }
}
