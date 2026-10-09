import * as vscode from 'vscode';
import type { Controller } from './controller';
import type { BridgeCall } from './bridgeClient';
import type { Project } from './projects';
import type { JsonObject, JsonValue, RuntimeInfo } from './shared/protocol';
import { projectOverlays } from './documents';
import { text } from './catalog';
import { relativePath } from './paths';

export function callBridge(
  host: Controller,
  operation: BridgeCall['operation'],
  project: Project,
  runtime: RuntimeInfo,
  signal: AbortSignal,
  options?: JsonObject,
): Promise<JsonValue> {
  const configuration = vscode.workspace.getConfiguration('lhp', vscode.Uri.file(project.root));
  return host.bridge.call({
    operation,
    interpreter: runtime.interpreter,
    projectRoot: project.root,
    environment: host.environment(project),
    signal,
    documents:
      operation === 'generate'
        ? undefined
        : projectOverlays(
            project.root,
            host.projects
              .filter((candidate) => candidate !== project)
              .map((candidate) => candidate.root),
          ),
    options: {
      sandboxEnabled: host.sandboxMode === 'on',
      includeTests: configuration.get<boolean>('includeTestsInGeneration', false),
      pipelineConfigPath: host.activePipelineConfig(project),
      nestedProjectRoots: host.projects
        .filter((candidate) => candidate !== project)
        .map((candidate) => relativePath(project.root, candidate.root))
        .filter((value): value is string => !!value),
      ...options,
    },
    timeoutMs: configuration.get<number>('operationTimeoutSeconds', 180) * 1000,
    onEvent: (event) => {
      if (!signal.aborted)
        host.publishStatus({
          operation:
            operation === 'scaffold'
              ? 'create'
              : operation === 'health' || operation === 'init'
                ? 'snapshot'
                : operation,
          running: true,
          message: text(event.message, text(event.kind)),
        });
    },
  });
}
