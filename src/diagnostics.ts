import * as vscode from 'vscode';
import { containedPath } from './paths';
import type { EditorDiagnostic } from './shared/protocol';

export class Problems implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('LHP');
  async update(root: string, diagnostics: EditorDiagnostic[], current = () => true): Promise<void> {
    const entries = new Map<string, vscode.Diagnostic[]>();
    for (const issue of diagnostics) {
      let filename: string;
      try {
        filename = await containedPath(root, issue.source?.path || 'lhp.yaml');
      } catch {
        filename = await containedPath(root, 'lhp.yaml');
      }
      const source = issue.source?.range;
      const range = source
        ? new vscode.Range(
            source.start.line,
            source.start.character,
            source.end.line,
            source.end.character,
          )
        : new vscode.Range(0, 0, 0, 1);
      const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        issue.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : issue.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = `LHP ${issue.layer}`;
      diagnostic.code = issue.code;
      entries.set(filename, [...(entries.get(filename) ?? []), diagnostic]);
    }
    if (!current()) return;
    this.collection.clear();
    for (const [filename, values] of entries)
      this.collection.set(vscode.Uri.file(filename), values);
  }
  clear(): void {
    this.collection.clear();
  }
  dispose(): void {
    this.collection.dispose();
  }
}
