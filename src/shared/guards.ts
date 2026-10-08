import { WEBVIEW_REQUEST_TYPES, type JsonValue, type WebviewRequest } from './protocol';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isJsonValue(value: unknown, depth = 0, maxArrayLength = 10000): value is JsonValue {
  if (depth > 30) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= maxArrayLength &&
      value.every((item) => isJsonValue(item, depth + 1, maxArrayLength))
    );
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        isJsonValue(item, depth + 1, maxArrayLength),
    )
  );
}
const string = (v: unknown) => typeof v === 'string' && v.length <= 1000000;
const nonempty = (v: unknown) => string(v) && (v as string).length > 0;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const object = (v: unknown) => isRecord(v) && isJsonValue(v);
function source(v: unknown): boolean {
  if (!isRecord(v) || !nonempty(v.path)) return false;
  if (v.documentIndex !== undefined && !count(v.documentIndex)) return false;
  if (
    v.yamlPath !== undefined &&
    (!Array.isArray(v.yamlPath) || !v.yamlPath.every((x) => string(x) || count(x)))
  )
    return false;
  if (v.range !== undefined) {
    if (!isRecord(v.range)) return false;
    for (const p of [v.range.start, v.range.end]) {
      if (!isRecord(p) || !count(p.line) || !count(p.character)) return false;
    }
  }
  return true;
}
function mutation(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'add':
      return nonempty(v.flowgroupId) && object(v.action);
    case 'delete':
      return nonempty(v.actionId);
    case 'duplicate':
      return nonempty(v.actionId) && nonempty(v.newName);
    case 'configure':
      return nonempty(v.actionId) && object(v.values);
    case 'configureFlowgroup':
      return nonempty(v.flowgroupId) && object(v.values);
    case 'connect':
    case 'disconnect':
      return nonempty(v.sourceId) && nonempty(v.targetId) && nonempty(v.dataset);
    case 'setValue':
      return source(v.source) && isJsonValue(v.value);
    default:
      return false;
  }
}
export function parseWebviewRequest(value: unknown): WebviewRequest {
  if (
    !isRecord(value) ||
    !isJsonValue(value) ||
    !nonempty(value.requestId) ||
    typeof value.type !== 'string' ||
    !(WEBVIEW_REQUEST_TYPES as readonly string[]).includes(value.type)
  ) {
    throw new Error('Invalid or unsupported designer request.');
  }
  if (JSON.stringify(value).length > 4 * 1024 * 1024)
    throw new Error('Designer request exceeds size limit.');
  if (
    value.context !== undefined &&
    (!isRecord(value.context) ||
      !nonempty(value.context.projectId) ||
      !count(value.context.revision))
  ) {
    throw new Error('Invalid designer context.');
  }
  let valid = true;
  switch (value.type) {
    case 'selectProject':
      valid = nonempty(value.projectId);
      break;
    case 'selectEnvironment':
      valid = nonempty(value.environment);
      break;
    case 'openSource':
      valid = source(value.source);
      break;
    case 'showPreviewFile':
      valid = nonempty(value.path);
      break;
    case 'mutate':
      valid =
        nonempty(value.projectId) &&
        isRecord(value.documentVersions) &&
        Object.values(value.documentVersions).every(count) &&
        mutation(value.mutation);
      break;
    case 'createBronze':
      valid =
        isRecord(value.values) &&
        ['name', 'pipeline', 'sourcePath', 'format', 'target'].every((k) =>
          nonempty(value.values && (value.values as Record<string, unknown>)[k]),
        );
      break;
    case 'createInstance':
      valid =
        isRecord(value.values) &&
        ['template', 'blueprint'].includes(String(value.values.kind)) &&
        ['definition', 'targetPath'].every((k) =>
          nonempty((value.values as Record<string, unknown>)[k]),
        ) &&
        (value.values.kind === 'blueprint' ||
          (nonempty(value.values.name) && nonempty(value.values.pipeline))) &&
        object(value.values.parameters);
      break;
  }
  if (!valid) throw new Error(`Malformed ${value.type} request.`);
  return value as unknown as WebviewRequest;
}
