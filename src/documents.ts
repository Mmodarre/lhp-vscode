import * as vscode from 'vscode';
import { containedPath, relativePath } from './paths';
import { planMutation, sourceOffset } from './yamlEdits';
import type {
  ActionMutation,
  DocumentOverlay,
  DocumentSnapshot,
  ProjectSnapshot,
  SourceRef,
} from './shared/protocol';

export function projectOverlays(root: string): DocumentOverlay[] {
  return vscode.workspace.textDocuments
    .filter(
      (document) =>
        document.uri.scheme === 'file' &&
        /\.(?:ya?ml|sql|py|json|ddl)$/i.test(document.uri.path) &&
        document.isDirty &&
        !!relativePath(root, document.uri.fsPath),
    )
    .map((document) => ({
      path: relativePath(root, document.uri.fsPath)!,
      version: document.version,
      text: document.getText(),
    }));
}
export async function snapshotDocuments(
  root: string,
  snapshot: ProjectSnapshot,
): Promise<DocumentSnapshot[]> {
  const paths = new Set(
    snapshot.flowgroups
      .flatMap((f) => [
        f.source.path,
        f.origin.instance?.path,
        f.origin.definition?.path,
        ...f.actions.map((a) => a.source.path),
      ])
      .filter((p): p is string => !!p),
  );
  for (const overlay of projectOverlays(root)) paths.add(overlay.path);
  const filenames = [...paths];
  const result = new Array<DocumentSnapshot>(filenames.length);
  let next = 0;
  // Bound native-editor IPC concurrency while retaining a real document version
  // for every source, including unopened files. Array order stays deterministic.
  await Promise.all(
    Array.from({ length: Math.min(8, filenames.length) }, async () => {
      while (next < filenames.length) {
        const index = next++;
        const filename = filenames[index]!;
        const uri = vscode.Uri.file(await containedPath(root, filename));
        const document = await vscode.workspace.openTextDocument(uri);
        result[index] = {
          path: filename,
          version: document.version,
          dirty: document.isDirty,
          text: document.getText(),
        };
      }
    }),
  );
  return result;
}
export async function openSource(
  root: string,
  source: SourceRef,
  preserveFocus = true,
): Promise<vscode.TextEditor> {
  const uri = vscode.Uri.file(await containedPath(root, source.path));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus,
    preview: true,
  });
  const offset = source.yamlPath ? sourceOffset(document.getText(), source) : undefined;
  const start =
    offset !== undefined
      ? document.positionAt(offset)
      : new vscode.Position(source.range?.start.line ?? 0, source.range?.start.character ?? 0);
  const range = document.validateRange(new vscode.Range(start, start));
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}
export async function applyMutation(
  root: string,
  snapshot: ProjectSnapshot,
  mutation: ActionMutation,
  versions: Record<string, number>,
): Promise<vscode.Uri | undefined> {
  const documents = await snapshotDocuments(root, snapshot);
  const planned = planMutation(snapshot, mutation, documents, versions);
  const edit = new vscode.WorkspaceEdit();
  let last: vscode.Uri | undefined;
  for (const change of planned) {
    const uri = vscode.Uri.file(await containedPath(root, change.path));
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.version !== change.version)
      throw new Error('The document changed. Refresh the form before applying it.');
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      change.text,
    );
    last = uri;
  }
  // No asynchronous work between this final guard and applyEdit: VS Code owns
  // the edit transaction and its native undo stack.
  for (const change of planned) {
    const document = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === vscode.Uri.file(root + '/' + change.path).fsPath,
    );
    if (!document || document.version !== change.version)
      throw new Error('The document changed while preparing the edit.');
  }
  if (!(await vscode.workspace.applyEdit(edit)))
    throw new Error('VS Code could not apply the document edit.');
  return last;
}
