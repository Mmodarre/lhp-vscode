import * as vscode from 'vscode';
import { Controller } from './controller';
import { LanguageServices } from './languageServices';
import { ProjectSidebar } from './sidebar';

export interface ExtensionApi {
  controller: Controller;
  languages: LanguageServices;
  sidebar: ProjectSidebar;
}
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const languages = new LanguageServices();
  const controller = new Controller(context, (snapshot, root) => languages.update(root, snapshot));
  const sidebar = new ProjectSidebar(controller);
  context.subscriptions.push(controller, languages, sidebar);
  const syncLanguageContext = () => {
    languages.setProjectRoots(controller.projects.map((project) => project.root));
    const project = controller.project;
    if (!project) return;
    languages.updateEnvironment(project.root, controller.environment(project));
    if (controller.catalog) languages.updateCatalog(project.root, controller.catalog);
    else languages.clearCatalog(project.root);
    if (controller.resourceIndex) languages.updateInventory(project.root, controller.resourceIndex);
  };
  context.subscriptions.push(controller.onDidChangeState(syncLanguageContext));
  const commands: Record<string, () => Promise<unknown> | void> = {
    openDesigner: () => controller.show(),
    refresh: async () => {
      await controller.refreshResources();
      await controller.refresh();
    },
    selectProject: () => controller.selectProject(),
    selectInterpreter: () => controller.interpreter(),
    setupEnvironment: () => controller.interpreter(true),
    createProject: () => controller.create(),
    selectEnvironment: () => controller.selectEnvironment(),
    validate: () => controller.operate('validate'),
    preview: () => controller.operate('preview'),
    generate: () => controller.operate('generate'),
    openDatabricks: () => controller.databricks(),
    cancel: () => controller.cancel(),
  };
  for (const [name, handler] of Object.entries(commands))
    context.subscriptions.push(
      vscode.commands.registerCommand(`lhp.${name}`, async () => {
        try {
          return await handler();
        } catch (error) {
          controller.report(error);
        }
      }),
    );
  try {
    await languages.register();
  } catch (error) {
    controller.report(error);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      setTimeout(() => languages.prune(controller.projects.map((project) => project.root)), 500);
    }),
  );
  await controller.discover().catch((error) => controller.report(error));
  return { controller, languages, sidebar };
}
