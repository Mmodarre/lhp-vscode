import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isMap, isScalar, LineCounter, parseAllDocuments } from 'yaml';
import type { ProjectResource, SourceRef, SubstitutionToken } from './shared/protocol';

export const resourceId = (filename: string): string =>
  createHash('sha256').update(filename).digest('base64url');
const mapping = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Conventions are hints; explicit selected paths and parsed content take priority. */
export function classifyResource(
  filename: string,
  configPath = '',
  content?: string,
): ProjectResource {
  const result: ProjectResource = {
    id: resourceId(filename),
    path: filename,
    source: { path: filename },
    name: path.posix.basename(filename),
    kind: 'other',
    exists: true,
    registered: false,
    consumers: [],
  };
  const basename = result.name;
  if (filename.startsWith('generated/') || filename.startsWith('resources/lhp/')) {
    result.kind = 'generated';
    result.environment = filename.startsWith('generated/') ? filename.split('/')[1] : undefined;
    result.generatedKind = filename.startsWith('resources/lhp/')
      ? 'bundle'
      : filename.endsWith('.whl')
        ? 'wheel'
        : /monitoring/i.test(filename)
          ? 'monitoring'
          : filename.endsWith('.py')
            ? 'source'
            : 'other';
    return result;
  }
  if (filename === 'lhp.yaml') {
    result.kind = 'configuration';
    result.configurationKind = 'project';
  } else if (filename === '.lhp/profile.yaml') {
    result.kind = 'configuration';
    result.configurationKind = 'profile';
  } else if (filename === configPath || /^pipeline_config[^/]*\.ya?ml$/i.test(basename)) {
    result.kind = 'configuration';
    result.configurationKind = 'pipeline';
  } else if (filename.startsWith('templates/bundle/')) {
    result.kind = 'configuration';
    result.configurationKind = 'bundle-template';
  } else if (basename === 'databricks.yml' || filename.startsWith('bundle/')) {
    result.kind = 'configuration';
    result.configurationKind = 'bundle';
  } else if (/^monitoring_job_config[^/]*\.ya?ml$/i.test(basename)) {
    result.kind = 'configuration';
    result.configurationKind = 'monitoring';
  } else if (/^job_config[^/]*\.ya?ml$/i.test(basename)) {
    result.kind = 'configuration';
    result.configurationKind = 'job';
  } else if (/^substitutions\/[^/]+\.ya?ml$/i.test(filename)) {
    result.kind = 'configuration';
    result.configurationKind = 'environment';
    result.environment = basename.replace(/\.ya?ml$/i, '');
  } else if (/\.sql$/i.test(filename)) result.kind = 'sql';
  else if (/\.py$/i.test(filename)) result.kind = 'python';
  else if (/\.ddl$/i.test(filename) || /^(schemas|schema_transforms)\//.test(filename))
    result.kind = 'schema';
  else if (filename.startsWith('expectations/')) result.kind = 'expectations';
  else if (filename.startsWith('presets/')) result.kind = 'preset';
  else if (filename.startsWith('blueprints/')) result.kind = 'blueprint';
  else if (filename.startsWith('templates/')) result.kind = 'template';
  else if (filename.startsWith('pipelines/')) result.kind = 'pipeline';
  else if (filename.startsWith('config/')) {
    result.kind = 'configuration';
    result.configurationKind = 'other';
  }
  if (!content || !/\.ya?ml$/i.test(filename) || result.kind === 'configuration') return result;
  try {
    for (const document of parseAllDocuments(content)) {
      if (document.errors.length) continue;
      const raw = mapping(document.toJS({ maxAliasCount: 25 }));
      if (raw.use_blueprint || raw.pipeline || raw.flowgroup) result.kind = 'pipeline';
      else if (Array.isArray(raw.flowgroups) && raw.name) result.kind = 'blueprint';
      else if (Array.isArray(raw.actions) && raw.name) result.kind = 'template';
      if (typeof raw.name === 'string') result.name = raw.name;
    }
  } catch {
    /* Invalid YAML remains browsable by its physical identity. */
  }
  return result;
}

/** Keys and exact source addresses only. Values, especially secrets, stay in source. */
export function substitutionKeys(
  filename: string,
  content: string,
  environment: string,
): SubstitutionToken[] {
  const result: SubstitutionToken[] = [];
  const lineCounter = new LineCounter();
  try {
    parseAllDocuments(content, { lineCounter }).forEach((doc, documentIndex) => {
      if (!isMap(doc.contents)) return;
      const addMapping = (value: unknown, prefix: (string | number)[]): void => {
        if (!isMap(value)) return;
        for (const pair of value.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
          const name = pair.key.value;
          if (prefix.length === 0 && !['global', environment].includes(name)) continue;
          const start = lineCounter.linePos(pair.key.range?.[0] ?? 0);
          const source: SourceRef = {
            path: filename,
            documentIndex,
            yamlPath: [...prefix, name],
            range: {
              start: { line: start.line - 1, character: start.col - 1 },
              end: { line: start.line - 1, character: start.col - 1 + name.length },
            },
          };
          if (prefix.length === 0) {
            if (isMap(pair.value)) addMapping(pair.value, [name]);
          } else
            result.push({
              name,
              source,
              environment,
              secretReference: name === 'secrets' || /secret/i.test(name),
            });
        }
      };
      addMapping(doc.contents, []);
    });
  } catch {
    /* Incomplete documents still retain their file entry. */
  }
  return result;
}
