import * as vscode from 'vscode';

/** Opening the trust editor is navigation, not consent. Always require a fresh invocation. */
export async function ensureOnboardingTrust(action: string): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  const manage = 'Manage Workspace Trust';
  const choice = await vscode.window.showWarningMessage(
    `${action} requires workspace trust to run Python and write project files. Review this folder in Manage Workspace Trust, then run ${action} again.`,
    manage,
  );
  if (choice === manage) {
    try {
      await vscode.commands.executeCommand('workbench.trust.manage');
    } catch {
      void vscode.window.showErrorMessage(
        `Open “Workspaces: Manage Workspace Trust” from the Command Palette, review this folder, then run ${action} again.`,
      );
    }
  }
  return false;
}

export function assertWorkspaceTrust(): void {
  if (!vscode.workspace.isTrusted)
    throw new Error(
      'Workspace trust is required. Review Manage Workspace Trust, then retry the command.',
    );
}

function workspaceIdentity(): string {
  return JSON.stringify([
    vscode.workspace.workspaceFile?.toString(),
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()),
  ]);
}

/** Dialogs must not carry an onboarding operation into a different workspace/project. */
export function onboardingContext(isCurrent = () => true): () => void {
  const identity = workspaceIdentity();
  return () => {
    assertWorkspaceTrust();
    if (identity !== workspaceIdentity() || !isCurrent())
      throw new Error(
        'The active workspace or project changed. Run the command again for the current context.',
      );
  };
}
