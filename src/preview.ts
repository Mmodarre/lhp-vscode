import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { PreviewResult } from './shared/protocol';

const previewPath = (path: string): string => path.replaceAll('\\', '/').replace(/^\/+/, '');

/** Content exists only for this revision; generated previews cannot be saved over source. */
export class PreviewDocuments implements vscode.TextDocumentContentProvider {
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changes.event;
  private readonly content = new Map<string, string>();
  private readonly paths = new Map<string, vscode.Uri>();
  set(result: PreviewResult): void {
    this.clear();
    const revision = randomUUID();
    for (const file of result.files) {
      const key = previewPath(file.path);
      const uri = vscode.Uri.from({
        scheme: 'lhp-preview',
        path: '/' + key,
        query: revision,
      });
      this.content.set(uri.toString(), file.content);
      this.paths.set(key, uri);
    }
  }
  clear(): void {
    const old = [...this.content.keys()];
    this.paths.clear();
    this.content.clear();
    for (const uri of old) this.changes.fire(vscode.Uri.parse(uri));
  }
  dispose(): void {
    this.clear();
    this.changes.dispose();
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      this.content.get(uri.toString()) ??
      'This preview has expired. Run Preview Generated Source again.'
    );
  }
  async show(path: string): Promise<void> {
    const uri = this.paths.get(previewPath(path));
    if (!uri) throw new Error('This preview is stale. Run preview again.');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
  }
  uri(path: string): vscode.Uri | undefined {
    return this.paths.get(previewPath(path));
  }
}
