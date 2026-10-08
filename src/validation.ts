import { items, record, text, projectFile } from './catalog';
import type { EditorDiagnostic, ProjectSnapshot } from './shared/protocol';

export function validationDiagnostics(
  response: unknown,
  snapshot: ProjectSnapshot,
  root: string,
): EditorDiagnostic[] {
  const result: EditorDiagnostic[] = [];
  for (const [pipeline, raw] of Object.entries(record(record(response).pipeline_responses))) {
    for (const value of items(record(raw).issues)) {
      const issue = record(value);
      const flowgroup = snapshot.flowgroups.find(
        (f) => f.pipeline === (issue.pipeline_name || pipeline) && f.name === issue.flowgroup_name,
      );
      result.push({
        severity: issue.severity === 'warning' ? 'warning' : 'error',
        code: text(issue.code) || undefined,
        message:
          [text(issue.title), text(issue.details), ...items(issue.suggestions).map((v) => text(v))]
            .filter(Boolean)
            .join('\n') || text(issue.message, 'LHP validation issue'),
        layer: 'configuration',
        source: issue.file_path ? { path: projectFile(root, issue.file_path) } : flowgroup?.source,
      });
    }
  }
  const r = record(response);
  if (r.success === false && !result.length)
    result.push({
      severity: 'error',
      layer: 'configuration',
      code: text(r.error_code) || undefined,
      message: text(r.error_message, 'Validation did not succeed.'),
    });
  return result;
}
