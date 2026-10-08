import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseWebviewRequest } from './shared/guards';
import type { HostMessage, WebviewRequest } from './shared/protocol';

export class DesignerPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly receive: (request: WebviewRequest) => Promise<void>,
  ) {}
  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'lhp.designer',
      'LHP Pipeline Designer',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
      },
    );
    this.panel = panel;
    const webview = panel.webview;
    const nonce = randomBytes(24).toString('base64');
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'),
    );
    webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link href="${style}" rel="stylesheet"><title>LHP Pipeline Designer</title></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const listener = webview.onDidReceiveMessage((value: unknown) => {
      try {
        const request = parseWebviewRequest(value);
        void this.receive(request).catch((error) => this.error(error, request.requestId));
      } catch (error) {
        this.error(error);
      }
    });
    panel.onDidDispose(() => {
      listener.dispose();
      this.panel = undefined;
    });
  }
  post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
  }
  error(error: unknown, requestId?: string): void {
    this.post({
      type: 'error',
      requestId,
      code: 'HOST_ERROR',
      message: error instanceof Error ? error.message : 'The operation failed.',
      recoverable: true,
    });
  }
  dispose(): void {
    this.panel?.dispose();
  }
}
