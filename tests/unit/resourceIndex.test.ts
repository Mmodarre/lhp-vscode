import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyResource, substitutionKeys } from '../../src/resourceClassification';
import { enrichResources, scanResources, updateResourceFile } from '../../src/resourceIndex';
import type { EditorCatalog } from '../../src/shared/protocol';
import { demoSnapshot } from '../../webview/src/demoFixture';
import { flowgroupFileLinks } from '../../src/sidebarFileLinks';
import { normalizeRelatedFile } from '../../src/catalog';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'lhp-resources-'));
  roots.push(root);
  return root;
}
async function file(root: string, filename: string, content = ''): Promise<void> {
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await writeFile(path.join(root, filename), content);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('independent physical resource inventory', () => {
  it('keeps malformed and arbitrary referenced source paths, excludes nested roots/cache/symlinks, and reports budgets', async () => {
    const root = await fixture();
    const outside = await fixture();
    await file(root, 'pipelines/broken.yaml', 'flowgroup: [broken');
    await file(root, 'custom/query.sql', 'SELECT 1');
    await file(root, 'child/lhp.yaml', 'name: child');
    await file(root, 'child/pipelines/foreign.yaml', 'pipeline: child');
    await file(root, '.venv/private.yaml', 'not: indexed');
    await file(root, 'generated/dev/orders.py', '# generated');
    await file(outside, 'outside.yaml', 'not: inspected');
    await symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const index = await scanResources(root, 'p', {
      revision: 1,
      otherRoots: [path.join(root, 'child')],
    });
    expect(index.files.map((item) => item.path)).toEqual([
      'custom/query.sql',
      'generated/dev/orders.py',
      'pipelines/broken.yaml',
    ]);
    expect(index.files.find((item) => item.path.includes('broken'))?.kind).toBe('pipeline');
    expect(index.files.find((item) => item.kind === 'generated')?.environment).toBe('dev');
    const limited = await scanResources(root, 'p', { revision: 1, limit: 1 });
    expect(limited.complete).toBe(false);
    expect(limited.warnings.join(' ')).toContain('incomplete');
  });
  it('updates just the edited file from native draft without rewriting source or reparsing other files', async () => {
    const root = await fixture();
    await file(
      root,
      'substitutions/dev.yaml',
      'global:\n  catalog: saved\ndev:\n  schema: bronze\nsecrets:\n  default_scope: private\n',
    );
    await file(root, 'blueprints/no_parameters.yaml', 'name: b\nflowgroups: []\n');
    const index = await scanResources(root, 'p', { revision: 1 });
    const other = index.files.find((entry) => entry.kind === 'blueprint');
    const updated = await updateResourceFile(root, index, 'substitutions/dev.yaml', {
      revision: 2,
      overlays: [
        {
          path: 'substitutions/dev.yaml',
          text: 'global:\n  new_token: draft\ndev:\n  nested: {one: two}\nsecrets:\n  default_scope: private\n',
        },
      ],
    });
    expect(updated.files.find((entry) => entry.kind === 'blueprint')).toBe(other);
    expect(updated.tokens.map((token) => token.name)).toEqual(['new_token', 'nested']);
    expect(await readFile(path.join(root, 'substitutions/dev.yaml'), 'utf8')).toContain(
      'catalog: saved',
    );
  });
  it('distinguishes bundle templates/configured paths and parameterless blueprints', () => {
    expect(classifyResource('templates/bundle/job_config.yaml').configurationKind).toBe(
      'bundle-template',
    );
    expect(classifyResource('settings/custom.yaml', 'settings/custom.yaml').configurationKind).toBe(
      'pipeline',
    );
    expect(classifyResource('arbitrary/b.yaml', '', 'name: b\nflowgroups: []\n').kind).toBe(
      'blueprint',
    );
    expect(
      substitutionKeys(
        'substitutions/dev.yaml',
        'global:\n  shared: value\ndev:\n  own: value\nprod:\n  wrong: no\nsecrets:\n  scopes: {}\n',
        'dev',
      ).map((token) => token.name),
    ).toEqual(['shared', 'own']);
  });
  it('does not reinsert excluded files incrementally or call capped catalogue entries missing', async () => {
    const root = await fixture();
    await file(root, '.superdesign/example.yaml', 'name: ignored');
    await file(root, 'child/lhp.yaml', 'name: child');
    await file(root, 'child/templates/t.yaml', 'name: child_template');
    const options = { revision: 1, otherRoots: [path.join(root, 'child')] };
    const index = await scanResources(root, 'p', options);
    expect(await updateResourceFile(root, index, '.superdesign/example.yaml', options)).toBe(index);
    expect(await updateResourceFile(root, index, 'child/templates/t.yaml', options)).toBe(index);
    const catalogue = {
      templates: [{ name: 'known', source: { path: 'templates/known.yaml' }, fields: [] }],
      presets: [],
      blueprints: [],
      actions: [],
      schemas: {},
    } as unknown as EditorCatalog;
    const enriched = enrichResources({ ...index, complete: false }, catalogue);
    expect(enriched.files.find((item) => item.path === 'templates/known.yaml')?.exists).toBe(true);
  });
  it('counts a parameter-provided SQL target across two flowgroups and its shared template', async () => {
    const root = await fixture();
    await file(root, 'sql/shared.sql', 'SELECT 1');
    await file(root, 'templates/reuse.yaml', 'name: reuse\nactions: []\n');
    await file(root, 'pipelines/one.yaml', 'pipeline: bronze\nflowgroup: one\n');
    await file(root, 'pipelines/two.yaml', 'pipeline: bronze\nflowgroup: two\n');
    const referenceSource = { path: 'templates/reuse.yaml', yamlPath: ['actions', 0, 'sql_path'] };
    const base = demoSnapshot();
    const groups = ['one', 'two'].map((name) => ({
      ...base.flowgroups[0]!,
      id: name,
      name,
      pipeline: 'bronze',
      source: { path: `pipelines/${name}.yaml` },
      origin: {
        kind: 'template' as const,
        definition: { path: 'templates/reuse.yaml' },
        instance: { path: `pipelines/${name}.yaml` },
      },
      actions: [
        {
          ...base.flowgroups[0]!.actions[0]!,
          id: `${name}:sql`,
          flowgroupId: name,
          name: 'shared_sql',
          source: referenceSource,
          origin: {
            kind: 'template' as const,
            definition: { path: 'templates/reuse.yaml' },
            instance: { path: `pipelines/${name}.yaml` },
          },
          relatedFiles: [
            {
              path: 'sql/shared.sql',
              kind: 'sql' as const,
              exists: true,
              editable: true,
              referenceSource,
            },
          ],
        },
      ],
    }));
    const snapshot = { ...base, flowgroups: groups, refreshState: 'ready' as const, stale: false };
    const catalog = {
      ...base.catalog,
      templates: [{ name: 'reuse', source: { path: 'templates/reuse.yaml' }, fields: [] }],
    };
    const indexed = enrichResources(
      await scanResources(root, 'p', { revision: 1 }),
      catalog,
      snapshot,
    );
    const sql = indexed.files.find((item) => item.path === 'sql/shared.sql')!;
    expect(sql.knownUseCount).toBe(3);
    expect(sql.knownUses?.map((use) => use.label)).toContain('Template reuse');
    expect(sql.knownUses?.filter((use) => use.flowgroupId).map((use) => use.flowgroupId)).toEqual([
      'one',
      'two',
    ]);
    expect(sql.knownUses?.find((use) => use.template)?.source).toEqual(referenceSource);
    expect(sql.usageComplete).toBe(false); // Parameter/dynamic references are known-only.
    expect(
      groups.every(
        (group) =>
          flowgroupFileLinks(group).filter((file) => file.source.path === sql.path).length === 1,
      ),
    ).toBe(true);
  });
  it('scans only the canonical sandbox profile under .lhp and excludes other private state', async () => {
    const root = await fixture();
    await file(root, '.lhp/profile.yaml', 'sandbox:\n  namespace: alice\n  pipelines: [bronze]\n');
    await file(root, '.lhp/private.yaml', 'secret: excluded');
    await file(root, '.lhp/nested/profile.yaml', 'secret: excluded');
    const index = await scanResources(root, 'p', { revision: 1 });
    expect(index.files.map((item) => item.path)).toEqual(['.lhp/profile.yaml']);
    expect(index.files[0]?.configurationKind).toBe('profile');
    expect(await updateResourceFile(root, index, '.lhp/private.yaml', { revision: 2 })).toBe(index);
  });
  it('retains a provable SQL usage in an unused template from the public catalogue', async () => {
    const root = await fixture();
    await file(root, 'templates/unused.yaml', 'name: unused\nactions: []\n');
    await file(root, 'sql/unused.sql', 'SELECT 1');
    const catalog: EditorCatalog = {
      actions: [],
      blueprints: [],
      presets: [],
      schemas: [],
      templates: [{ name: 'unused', source: { path: 'templates/unused.yaml' }, fields: [] }],
      templateRelatedFiles: {
        'templates/unused.yaml': [
          {
            path: 'sql/unused.sql',
            kind: 'sql',
            exists: true,
            editable: true,
            actionName: 'query',
            referenceSource: {
              path: 'templates/unused.yaml',
              yamlPath: ['actions', 0, 'sql_path'],
            },
          },
          {
            path: 'sql/%{query}.sql',
            kind: 'sql',
            exists: false,
            editable: false,
            actionName: 'param_query',
            dynamic: true,
            referenceSource: {
              path: 'templates/unused.yaml',
              yamlPath: ['actions', 1, 'sql_path'],
            },
          },
        ],
      },
    };
    const indexed = enrichResources(await scanResources(root, 'p', { revision: 1 }), catalog);
    const sql = indexed.files.find((file) => file.path === 'sql/unused.sql')!;
    expect(sql.knownUseCount).toBe(1);
    expect(sql.knownUses?.[0]).toMatchObject({
      template: 'unused',
      label: 'Template unused / query',
      source: { path: 'templates/unused.yaml', yamlPath: ['actions', 0, 'sql_path'] },
    });
    expect(sql.usageComplete).toBe(false);
    expect(indexed.files.some((file) => file.path === 'sql/%{query}.sql')).toBe(false);
    expect(
      normalizeRelatedFile(root, { path: 'sql/%{query}.sql', kind: 'sql', exists: false }).dynamic,
    ).toBe(true);
  });
});
