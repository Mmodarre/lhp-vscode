import * as vscode from 'vscode';
import { Controller } from './controller';
import { LanguageServices } from './languageServices';

export interface ExtensionApi {
  controller: Controller;
  languages: LanguageServices;
}
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const languages = new LanguageServices();
  const controller = new Controller(context, (snapshot, root) => languages.update(root, snapshot));
  context.subscriptions.push(controller, languages);
  const commands: Record<string, () => Promise<unknown> | void> = {
    openDesigner: () => controller.show(),
    refresh: () => controller.refresh(),
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
  return { controller, languages };
}
