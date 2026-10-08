import * as path from 'node:path';
import { readdir, readFile, stat, lstat } from 'node:fs/promises';
import type {
  EditorCatalog,
  ProjectResourceIndex,
  ProjectSnapshot,
  ResourceConsumer,
} from './shared/protocol';
import { classifyResource, resourceId, substitutionKeys } from './resourceClassification';
import { relativePath, containedPath, ignoredInventoryPath } from './paths';
const MAX_CLASSIFY_BYTES = 512 * 1024;
export interface IndexOptions {
  revision: number;
  otherRoots?: string[];
  pipelineConfigPath?: string;
  overlays?: { path: string; text: string }[];
  signal?: AbortSignal;
  /** Disclosed safety budget, configurable only by internal callers/tests. */
  limit?: number;
}

/** Metadata/source-only scan. Never follows symlinks or executes project code. */
export async function scanResources(
  root: string,
  projectId: string,
  options: IndexOptions,
): Promise<ProjectResourceIndex> {
  const limit = options.limit ?? 50000;
  const result: ProjectResourceIndex = {
    projectId,
    revision: options.revision,
    files: [],
    environments: [],
    tokens: [],
    complete: true,
    loading: false,
    warnings: [],
  };
  const filenames: string[] = [];
  const folders = [''];
  const nested = new Set(
    (options.otherRoots ?? []).map((p) => relativePath(root, p)).filter(Boolean),
  );
  let inspected = 0;
  let unreadable = false;
  let symlinks = 0;
  while (folders.length && result.complete) {
    options.signal?.throwIfAborted();
    const batch = folders.splice(0, 8);
    const batches = await Promise.all(
      batch.map(async (relative) => {
        try {
          return {
            relative,
            entries: await readdir(path.join(root, relative), { withFileTypes: true }),
          };
        } catch {
          unreadable = true;
          result.warnings.push(`Could not read directory: ${relative || '.'}`);
          return { relative, entries: [] };
        }
      }),
    );
    for (const { relative, entries } of batches)
      for (const entry of entries) {
        if (++inspected > limit) {
          result.complete = false;
          break;
        }
        const filename = relative ? `${relative}/${entry.name}` : entry.name;
        if (ignoredInventoryPath(filename)) continue;
        if (entry.isSymbolicLink()) {
          symlinks++;
          continue;
        }
        if (entry.isDirectory()) {
          if (!nested.has(filename)) folders.push(filename);
        } else if (entry.isFile()) filenames.push(filename);
      }
  }
  if (!result.complete)
    result.warnings.push(
      `Resource discovery reached its ${limit.toLocaleString()} entry budget. Use native Explorer for additional files; results are incomplete.`,
    );
  if (unreadable) result.complete = false;
  if (symlinks)
    result.warnings.push(
      `${symlinks} symbolic link(s) excluded from physical discovery. Catalogue links are checked for project containment when opened.`,
    );
  const overlays = new Map((options.overlays ?? []).map((v) => [v.path, v.text]));
  let next = 0;
  let oversized = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, filenames.length) }, async () => {
      while (next < filenames.length) {
        options.signal?.throwIfAborted();
        const filename = filenames[next++]!;
        let content: string | undefined;
        if (
          /\.ya?ml$/i.test(filename) &&
          !filename.startsWith('generated/') &&
          !filename.startsWith('resources/lhp/')
        ) {
          try {
            const draft = overlays.get(filename);
            const safe = await containedPath(root, filename);
            const size = draft === undefined ? (await stat(safe)).size : Buffer.byteLength(draft);
            if (size <= MAX_CLASSIFY_BYTES) content = draft ?? (await readFile(safe, 'utf8'));
            else oversized++;
          } catch {
            /* Source may have disappeared during scan. Preserve last observed path. */
          }
        }
        const item = classifyResource(filename, options.pipelineConfigPath, content);
        result.files.push(item);
        if (item.environment && item.configurationKind === 'environment') {
          result.environments.push(item.environment);
          if (content) result.tokens.push(...substitutionKeys(filename, content, item.environment));
        }
      }
    }),
  );
  options.signal?.throwIfAborted();
  if (oversized)
    result.warnings.push(
      `${oversized} large YAML file(s) remain browsable; content classification is limited to 512 KiB per file.`,
    );
  result.files.sort((a, b) => a.path.localeCompare(b.path));
  result.environments = [...new Set(result.environments)].sort();
  return result;
}

/** Content changes inspect one file; topology discovery remains an explicit scan. */
export async function updateResourceFile(
  root: string,
  index: ProjectResourceIndex,
  filename: string,
  options: IndexOptions,
): Promise<ProjectResourceIndex> {
  options.signal?.throwIfAborted();
  if (
    ignoredInventoryPath(filename) ||
    (options.otherRoots ?? []).some((other) => {
      const nested = relativePath(root, other);
      return nested && (filename === nested || filename.startsWith(`${nested}/`));
    })
  )
    return index;
  const safe = await containedPath(root, filename);
  let exists: boolean;
  try {
    const info = await lstat(safe);
    exists = info.isFile() && !info.isSymbolicLink();
  } catch {
    exists = false;
  }
  const old = index.files.find((item) => item.path === filename);
  if (!exists)
    return {
      ...index,
      revision: options.revision,
      files: index.files.filter((item) => item.path !== filename),
      tokens: index.tokens.filter((token) => token.source.path !== filename),
    };
  let content: string | undefined;
  if (/\.ya?ml$/i.test(filename)) {
    const overlay = options.overlays?.find((item) => item.path === filename)?.text;
    const size = overlay === undefined ? (await stat(safe)).size : Buffer.byteLength(overlay);
    if (size <= MAX_CLASSIFY_BYTES) content = overlay ?? (await readFile(safe, 'utf8'));
  }
  const item = classifyResource(filename, options.pipelineConfigPath, content);
  if (old) item.consumers = old.consumers;
  const tokens = index.tokens.filter((token) => token.source.path !== filename);
  if (item.configurationKind === 'environment' && item.environment && content)
    tokens.push(...substitutionKeys(filename, content, item.environment));
  return {
    ...index,
    revision: options.revision,
    files: old
      ? index.files.map((entry) => (entry.path === filename ? item : entry))
      : [...index.files, item].sort((a, b) => a.path.localeCompare(b.path)),
    tokens,
  };
}

/** Add authoritative catalogue identities/references without dropping malformed files. */
export function enrichResources(
  index: ProjectResourceIndex,
  catalog?: EditorCatalog,
  snapshot?: ProjectSnapshot,
): ProjectResourceIndex {
  const files = new Map(
    index.files.map((entry) => [entry.path, { ...entry, consumers: [] as ResourceConsumer[] }]),
  );
  const ensure = (filename: string, exists = false) => {
    let item = files.get(filename);
    if (!item) {
      item = { ...classifyResource(filename), exists };
      files.set(filename, item);
    }
    return item;
  };
  for (const kind of ['template', 'blueprint', 'preset'] as const) {
    const definitions =
      kind === 'template'
        ? catalog?.templates
        : kind === 'blueprint'
          ? catalog?.blueprints
          : catalog?.presets;
    for (const definition of definitions ?? [])
      if (definition.source) {
        // The runtime catalogue has read this definition. An incomplete physical
        // inventory must not turn absence from its scan into a missing-file claim.
        const item = ensure(definition.source.path, true);
        if (item.configurationKind === 'bundle-template') continue;
        item.kind = kind;
        item.name = definition.name;
        item.source = definition.source;
        item.registered = true;
      }
  }
  for (const fg of snapshot?.flowgroups ?? []) {
    const consumer = {
      label: `${fg.pipeline} / ${fg.name}`,
      source: fg.origin.instance ?? fg.source,
      pipeline: fg.pipeline,
      flowgroupId: fg.id,
    };
    if (fg.origin.definition) ensure(fg.origin.definition.path, true).consumers.push(consumer);
    for (const action of fg.actions) {
      const use = {
        ...consumer,
        label: `${consumer.label} / ${action.name}`,
        source: action.source,
        actionId: action.id,
      };
      for (const related of action.relatedFiles) {
        const item = ensure(related.path, related.exists);
        if (item.kind === 'other')
          item.kind = related.kind === 'config' ? 'configuration' : related.kind;
        item.consumers.push(use);
      }
      for (const preset of Array.isArray(action.raw.presets) ? action.raw.presets : []) {
        const definition = catalog?.presets.find((p) => p.name === preset);
        if (definition?.source) ensure(definition.source.path).consumers.push(use);
      }
    }
    for (const preset of Array.isArray(fg.raw.presets) ? fg.raw.presets : []) {
      const definition = catalog?.presets.find((p) => p.name === preset);
      if (definition?.source) ensure(definition.source.path).consumers.push(consumer);
    }
  }
  return {
    ...index,
    files: [...files.values()].map((item) => ({
      ...item,
      id: resourceId(item.path),
      consumers: [
        ...new Map(
          item.consumers.map((use) => [JSON.stringify([use.source, use.label]), use]),
        ).values(),
      ],
    })),
  };
}
