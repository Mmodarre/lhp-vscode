import * as vscode from 'vscode';
import type { Controller } from './controller';
import { applyMutation, openSource } from './documents';
import { scaffold, createFlowgroup } from './projectOperations';
import type { WebviewRequest } from './shared/protocol';

export async function dispatch(host: Controller, request: WebviewRequest): Promise<void> {
  const contextFree = [
    'ready',
    'refresh',
    'selectProject',
    'createProject',
    'selectInterpreter',
    'setupEnvironment',
    'cancel',
    'showHelp',
  ];
  if (
    contextFree.includes(request.type) &&
    request.context?.projectId &&
    request.context.projectId !== host.project?.summary.id
  )
    throw new Error('This request belongs to another project.');
  if (['undo', 'redo', 'openSource'].includes(request.type)) {
    if (request.context?.projectId !== host.project?.summary.id)
      throw new Error('This request belongs to another project.');
  } else if (!contextFree.includes(request.type)) host.assertContext(request);
  switch (request.type) {
    case 'ready':
      host.designerReady();
      break;
    case 'refresh':
      await host.refresh();
      break;
    case 'selectProject':
      await host.selectProject(request.projectId);
      break;
    case 'selectEnvironment':
      await host.selectEnvironment(request.environment);
      break;
    case 'setSandboxMode':
      await host.setSandboxMode(request.mode);
      break;
    case 'setPipelineDisplay':
      await host.setPipelineDisplay(request.display);
      break;
    case 'configureSandboxProfile':
      await host.configureSandboxProfile();
      break;
    case 'showSandboxScope':
      await host.showSandboxScope();
      break;
    case 'showUsages':
      await host.showUsages(request.path);
      break;
    case 'selectInterpreter':
      await host.interpreter();
      break;
    case 'setupEnvironment':
      await host.interpreter(true);
      break;
    case 'createProject':
      await host.create();
      break;
    case 'validate':
    case 'preview':
    case 'generate':
      await host.operate(request.type);
      break;
    case 'openSource':
      await openSource(
        host.readProject().root,
        host.snapshot?.stale ? { path: request.source.path } : request.source,
      );
      break;
    case 'showPreviewFile':
      await host.previews.show(request.path);
      break;
    case 'loadData':
      await host.loadData();
      break;
    case 'showHelp':
      await host.showHelp();
      break;
    case 'createFlowgroup':
      await createFlowgroup(host, request.values);
      break;
    case 'databricks':
      await host.databricks();
      break;
    case 'cancel':
      host.cancel();
      break;
    case 'createBronze':
    case 'createInstance':
      if (host.snapshot?.refreshState && host.snapshot.refreshState !== 'ready')
        throw new Error('Refresh the project successfully before creating a flowgroup.');
      await scaffold(host, request);
      break;
    case 'mutate': {
      const project = host.requireProject();
      if (request.projectId !== project.summary.id)
        throw new Error('This edit belongs to another project.');
      host.lastEdited = await applyMutation(
        project.root,
        host.snapshot!,
        request.mutation,
        request.documentVersions,
        host.projects
          .filter((candidate) => candidate !== project)
          .map((candidate) => candidate.root),
      );
      clearTimeout(host.timer);
      await host.refresh();
      break;
    }
    case 'undo':
    case 'redo':
      host.requireTrust();
      if (host.lastEdited)
        await vscode.window.showTextDocument(host.lastEdited, {
          preserveFocus: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
      await vscode.commands.executeCommand(request.type);
      break;
  }
  host.panel.post({ type: 'result', requestId: request.requestId, success: true });
}
