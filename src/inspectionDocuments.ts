import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

export class InspectionDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly contents = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      this.contents.get(uri.toString()) ??
      '# Inspection expired\n\nSource, environment or runtime changed. Run the inspection again.'
    );
  }
  async show(title: string, value: unknown, notices: string[]): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: 'lhp-inspection',
      path: `/${title.replace(/[^\w.-]+/g, '-')}.md`,
      query: randomUUID(),
    });
    const content = `# ${title}\n\n${notices.map((notice) => `- ${notice}`).join('\n')}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
    const bytes = Buffer.byteLength(content);
    if (bytes > 4 * 1024 * 1024)
      throw new Error(
        'Inspection exceeds the 4 MiB editor-document budget. Inspect a smaller resource or open its source.',
      );
    while (
      this.contents.size >= 4 ||
      [...this.contents.values()].reduce((sum, text) => sum + Buffer.byteLength(text), bytes) >
        8 * 1024 * 1024
    ) {
      const oldest = this.contents.keys().next().value;
      if (!oldest) break;
      this.contents.delete(oldest);
      this.changed.fire(vscode.Uri.parse(oldest));
    }
    this.contents.set(uri.toString(), content);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
  }
  clear(): void {
    const keys = [...this.contents.keys()];
    this.contents.clear();
    for (const key of keys) this.changed.fire(vscode.Uri.parse(key));
  }
  dispose(): void {
    this.clear();
    this.changed.dispose();
  }
}
