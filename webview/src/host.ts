import type { DesignerSelection, HostMessage, WebviewRequest } from '../../src/shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewRequest): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let api: VsCodeApi | undefined;
let sequence = 0;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function snapshotShape(value: unknown): boolean {
  if (!record(value) || !record(value.context) || !record(value.catalog)) return false;
  return (
    typeof value.revision === 'number' &&
    Array.isArray(value.pipelines) &&
    Array.isArray(value.flowgroups) &&
    Array.isArray(value.flowgroupEdges) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.diagnostics) &&
    Array.isArray(value.notices) &&
    Array.isArray(value.catalog.actions) &&
    Array.isArray(value.catalog.templates) &&
    Array.isArray(value.catalog.blueprints) &&
    record(value.context.project) &&
    record(value.context.runtime) &&
    typeof value.context.environment === 'string' &&
    Array.isArray(value.context.environments)
  );
}

function selectionShape(value: unknown): value is DesignerSelection {
  return (
    record(value) &&
    typeof value.projectId === 'string' &&
    Number.isSafeInteger(value.revision) &&
    (value.pipeline === undefined || typeof value.pipeline === 'string') &&
    (value.flowgroupId === undefined || typeof value.flowgroupId === 'string') &&
    (value.actionId === undefined || typeof value.actionId === 'string') &&
    (value.datasetId === undefined || typeof value.datasetId === 'string') &&
    (value.view === undefined ||
      ['project', 'pipeline', 'flowgroup', 'dataset'].includes(String(value.view)))
  );
}

function datasetShape(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.projectId === 'string' &&
    Number.isSafeInteger(value.revision) &&
    typeof value.environment === 'string' &&
    Array.isArray(value.datasets) &&
    Array.isArray(value.edges) &&
    Array.isArray(value.warnings) &&
    typeof value.stale === 'boolean'
  );
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!record(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'bootstrap':
      return (
        typeof value.protocolVersion === 'number' &&
        Array.isArray(value.projects) &&
        typeof value.trusted === 'boolean' &&
        (value.logoUri === undefined || typeof value.logoUri === 'string') &&
        (value.datasets === undefined || datasetShape(value.datasets)) &&
        (value.snapshot === undefined || snapshotShape(value.snapshot)) &&
        (value.selection === undefined || selectionShape(value.selection))
      );
    case 'select':
      return selectionShape(value.selection);
    case 'datasets':
      return datasetShape(value.datasets);
    case 'guide':
      return (
        typeof value.projectId === 'string' &&
        Number.isSafeInteger(value.revision) &&
        ['bronze', 'flowgroup', 'template', 'blueprint'].includes(String(value.guide)) &&
        (value.definition === undefined || typeof value.definition === 'string')
      );
    case 'snapshot':
      return snapshotShape(value.snapshot);
    case 'result':
      return typeof value.requestId === 'string' && typeof value.success === 'boolean';
    case 'error':
      return (
        typeof value.code === 'string' &&
        typeof value.message === 'string' &&
        typeof value.recoverable === 'boolean'
      );
    case 'status':
      return (
        record(value.status) &&
        typeof value.status.operation === 'string' &&
        typeof value.status.running === 'boolean' &&
        typeof value.status.message === 'string'
      );
    case 'preview':
      return (
        record(value.result) &&
        Array.isArray(value.result.files) &&
        Array.isArray(value.result.notices) &&
        record(value.result.documentVersions)
      );
    case 'diagnostics':
      return Array.isArray(value.diagnostics);
    default:
      return false;
  }
}

function vscode(): VsCodeApi | undefined {
  if (api) return api;
  if (typeof window.acquireVsCodeApi === 'function') api = window.acquireVsCodeApi();
  return api;
}

type WithoutRequestId<T> = T extends unknown ? Omit<T, 'requestId'> : never;
export type RequestBody = WithoutRequestId<WebviewRequest>;

export function request(value: RequestBody): string {
  const requestId = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
  vscode()?.postMessage({ ...value, requestId } as WebviewRequest);
  return requestId;
}

export function subscribe(listener: (message: HostMessage) => void): () => void {
  const handler = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (isHostMessage(value)) listener(value);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
