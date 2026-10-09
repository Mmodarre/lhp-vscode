import * as vscode from 'vscode';
import type { Controller } from './controller';
import type { SandboxViewState } from './shared/protocol';
import { configureSandboxProfile } from './sandboxProfile';
import { outputScopeLabel, sandboxScopeIdentity, type OutputScopeRecord } from './sandboxState';

export function sandboxMode(host: Controller): 'off' | 'on' {
  const id = host.project?.summary.id;
  return id &&
    host.context.workspaceState.get<Record<string, 'off' | 'on'>>('lhp.sandboxModes', {})[id] ===
      'on'
    ? 'on'
    : 'off';
}

export function pipelineDisplay(host: Controller): 'selected' | 'all' {
  const id = host.project?.summary.id;
  return id &&
    host.context.workspaceState.get<Record<string, 'selected' | 'all'>>('lhp.pipelineDisplays', {})[
      id
    ] === 'all'
    ? 'all'
    : 'selected';
}

export function currentSandboxView(host: Controller): SandboxViewState | undefined {
  const snapshot = host.snapshot;
  const current =
    snapshot && snapshot.context.project.id === host.project?.summary.id
      ? snapshot.sandbox
      : undefined;
  const view: SandboxViewState | undefined = current
    ? {
        ...current,
        mode: host.sandboxMode,
        display: host.pipelineDisplay,
        stale: current.stale || snapshot?.stale || snapshot?.refreshState !== 'ready',
        scopeComplete:
          current.scopeComplete && !snapshot?.stale && snapshot?.refreshState === 'ready',
      }
    : host.project
      ? {
          mode: host.sandboxMode,
          display: host.pipelineDisplay,
          profilePath: '.lhp/profile.yaml',
          profileExists: false,
          profileSource: 'missing',
          patterns: [],
          selectedPipelines: [],
          totalPipelines: 0,
          allowedEnvironments: [],
          environment: host.environment(host.project),
          valid: false,
          error: 'Refresh to inspect .lhp/profile.yaml.',
          stale: true,
          scopeComplete: false,
          previewParity: 'unknown',
        }
      : undefined;
  if (!view || !host.project) return view;
  const records = host.context.workspaceState.get<Record<string, OutputScopeRecord>>(
    'lhp.generatedOutputScopes',
    {},
  );
  const recorded = records[`${host.project.summary.id}:${view.environment}`];
  return recorded ? { ...view, generatedOutputScope: outputScopeLabel(view, recorded) } : view;
}

export async function setSandboxMode(host: Controller, mode: 'off' | 'on'): Promise<void> {
  const project = host.requireProject();
  if (mode !== 'off' && mode !== 'on') throw new Error('Invalid sandbox mode.');
  if (mode === host.sandboxMode) return;
  if (mode === 'on') {
    const runtime = host.runtime ?? host.snapshot?.context.runtime;
    if (!runtime?.compatible)
      throw new Error('Select a compatible LHP interpreter before enabling sandbox mode.');
    if (!runtime.capabilities.includes('sandbox_editor'))
      throw new Error(
        'This LHP runtime does not support sandbox editing. Run Set Up Python Environment or select a runtime with sandbox_editor support.',
      );
  }
  const modes = host.context.workspaceState.get<Record<string, 'off' | 'on'>>(
    'lhp.sandboxModes',
    {},
  );
  host.invalidateContext();
  await host.context.workspaceState.update('lhp.sandboxModes', {
    ...modes,
    [project.summary.id]: mode,
  });
  if (project !== host.project) return;
  await host.refresh();
  if (project !== host.project || mode !== host.sandboxMode) return;
  const snapshot = host.snapshot;
  if (
    mode === 'on' &&
    snapshot?.refreshState === 'ready' &&
    !snapshot.stale &&
    snapshot.sandbox?.profileExists === false
  )
    await configureSandboxProfile(host);
}

export async function setPipelineDisplay(
  host: Controller,
  display: 'selected' | 'all',
): Promise<void> {
  const project = host.readProject();
  if (display !== 'selected' && display !== 'all') throw new Error('Invalid pipeline display.');
  const displays = host.context.workspaceState.get<Record<string, 'selected' | 'all'>>(
    'lhp.pipelineDisplays',
    {},
  );
  await host.context.workspaceState.update('lhp.pipelineDisplays', {
    ...displays,
    [project.summary.id]: display,
  });
  if (project !== host.project) return;
  const sandbox = host.sandboxView;
  if (sandbox)
    host.panel.post({
      type: 'sandbox',
      projectId: project.summary.id,
      revision: host.epoch,
      sandbox,
    });
  host.notifyState();
}

export async function showSandboxScope(host: Controller): Promise<void> {
  const project = host.readProject();
  const view = host.sandboxView;
  if (!view) throw new Error('Select an LHP project first.');
  const lines = [
    `Mode: ${view.mode}. Profile: ${view.profilePath} (${view.profileSource}).`,
    `Environment: ${view.environment}. Namespace: ${view.namespace ?? 'none'}.`,
    `Selected pipelines (${view.selectedPipelines.length}/${view.totalPipelines}): ${view.selectedPipelines.join(', ') || 'none'}.`,
    `Patterns: ${view.patterns.join(', ') || 'none'}. Allowed environments: ${view.allowedEnvironments.join(', ') || 'all'}.`,
    `Policy: ${view.strategy ?? 'default'}${view.tablePattern ? `, ${view.tablePattern}` : ''}.`,
    view.error ? `Issue: ${view.error}` : 'Scope resolved from the active profile.',
    'Show all changes display only; generation still uses the selected scope.',
  ];
  const choice = await vscode.window.showInformationMessage(
    lines.join('\n'),
    { modal: true },
    'Open profile',
  );
  if (choice === 'Open profile') {
    if (project !== host.project)
      throw new Error(
        'Project changed while scope was open. Select the current project and retry.',
      );
    await configureSandboxProfile(host);
  }
}

export async function showUsages(host: Controller, path: string): Promise<void> {
  const resource = host.resourceIndex?.files.find((file) => file.path === path);
  if (!resource)
    throw new Error('This source is not in the current resource index. Refresh and retry.');
  await host.findConsumers(resource.id);
}

export async function recordOutputScope(host: Controller, expectedIdentity: string): Promise<void> {
  const project = host.project;
  const view = host.sandboxView;
  if (!project || !view || sandboxScopeIdentity(view) !== expectedIdentity)
    throw new Error('Sandbox scope changed after generation. Refresh output before reviewing it.');
  const records = host.context.workspaceState.get<Record<string, OutputScopeRecord>>(
    'lhp.generatedOutputScopes',
    {},
  );
  const identity = expectedIdentity;
  const label =
    view.mode === 'on'
      ? `Sandbox ${view.namespace}: ${view.selectedPipelines.length} pipeline(s), ${view.environment}`
      : `Full project, ${view.environment}`;
  await host.context.workspaceState.update('lhp.generatedOutputScopes', {
    ...records,
    [`${project.summary.id}:${view.environment}`]: { identity, label, externalChange: false },
  });
  if (project === host.project) host.notifyState();
}

/** Watcher events outside active generation can invalidate the recorded output state. */
export async function noteOutputChanged(host: Controller, relative: string): Promise<void> {
  const project = host.project;
  if (!project) return;
  const records = host.context.workspaceState.get<Record<string, OutputScopeRecord>>(
    'lhp.generatedOutputScopes',
    {},
  );
  const prefix = `${project.summary.id}:`;
  const environment = relative.startsWith('generated/') ? relative.split('/')[1] : undefined;
  let changed = false;
  const next = { ...records };
  for (const [key, record] of Object.entries(records)) {
    if (
      !key.startsWith(prefix) ||
      (environment && key !== `${prefix}${environment}`) ||
      record.externalChange
    )
      continue;
    next[key] = { ...record, externalChange: true };
    changed = true;
  }
  if (!changed) return;
  await host.context.workspaceState.update('lhp.generatedOutputScopes', next);
  if (project === host.project) host.notifyState();
}
