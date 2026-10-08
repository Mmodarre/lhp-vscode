import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { analyzeYaml, yamlCursorContext } from '../../src/languageContext';
import { classifyLhpYaml } from '../../src/languageClassification';
import { parameterContext } from '../../src/languageParameters';
import { referenceReplacement, tokenReplacement } from '../../src/languageInsert';
import {
  actionSnippets,
  referenceSuggestions,
  snippetForLine,
  substitutionSuggestions,
} from '../../src/languageSuggestions';
import { demoSnapshot } from '../../webview/src/demoFixture';
import type { ProjectResourceIndex } from '../../src/shared/projectModel';

const snapshot = demoSnapshot();
const catalog = {
  ...snapshot.catalog,
  presets: [{ name: 'high_throughput', source: { path: 'presets/high_throughput.yaml' } }],
  blueprints: [
    { name: 'medallion_demo', source: { path: 'blueprints/medallion_demo.yaml' }, fields: [] },
  ],
};
const index: ProjectResourceIndex = {
  projectId: 'demo',
  revision: 1,
  complete: true,
  loading: false,
  warnings: [],
  environments: ['dev'],
  tokens: [
    { name: 'landing_volume', environment: 'dev', source: { path: 'substitutions/dev.yaml' } },
  ],
  files: [
    {
      id: 'sql',
      kind: 'sql',
      path: 'queries/nested/order.sql',
      name: 'order.sql',
      source: { path: 'queries/nested/order.sql' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'module',
      kind: 'python',
      path: 'py_functions/order.py',
      name: 'order.py',
      source: { path: 'py_functions/order.py' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'bundle',
      kind: 'configuration',
      configurationKind: 'bundle-template',
      path: 'templates/bundle/job_config.yaml',
      name: 'job_config.yaml',
      source: { path: 'templates/bundle/job_config.yaml' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'bundle-other',
      kind: 'configuration',
      configurationKind: 'bundle-template',
      path: 'templates/bundle/variables.yaml',
      name: 'variables.yaml',
      source: { path: 'templates/bundle/variables.yaml' },
      exists: true,
      registered: false,
      consumers: [],
    },
    {
      id: 'custom',
      kind: 'pipeline',
      path: 'custom/orders.yaml',
      name: 'orders.yaml',
      source: { path: 'custom/orders.yaml' },
      exists: true,
      registered: false,
      consumers: [],
    },
  ],
};
function at(source: string, needle: string, from = 0) {
  const offset = source.indexOf(needle, from);
  if (offset < 0) throw new Error(`Missing test needle ${needle}`);
  return yamlCursorContext(source, offset + needle.length - 1);
}

describe('tolerant LHP YAML cursor context', () => {
  it('distinguishes flowgroup-level template, blueprint and preset references in a stream', () => {
    const source = [
      'pipeline: bronze',
      'flowgroup: orders',
      'use_template: csv_ingestion',
      'presets:',
      '  - high_throughput',
      '---',
      'pipeline: silver',
      'flowgroup: customers',
      'use_blueprint: medallion_demo',
    ].join('\n');
    const template = at(source, 'csv_ingestion');
    expect(template.path).toEqual(['use_template']);
    expect(
      referenceSuggestions('authoring', template, catalog).map((value) => value.label),
    ).toContain('csv_ingestion');
    const preset = at(source, 'high_throughput');
    expect(preset.path).toEqual(['presets', 0]);
    expect(preset.actionPath).toBeUndefined();
    expect(
      referenceSuggestions('authoring', preset, catalog).map((value) => value.label),
    ).toContain('high_throughput');
    const blueprint = at(source, 'medallion_demo');
    expect(blueprint.documentIndex).toBe(1);
    expect(blueprint.path).toEqual(['use_blueprint']);
    expect(
      referenceSuggestions('authoring', blueprint, catalog).map((value) => value.label),
    ).toContain('medallion_demo');
  });

  it('keeps nested source.type separate from the load action and suggests only exact file fields', () => {
    const source = [
      'pipeline: bronze',
      'flowgroup: orders',
      'actions:',
      '  - name: ingest',
      '    type: load',
      '    source:',
      '      type: cloudfiles',
      '      path: /landing/orders',
      '  - name: clean',
      '    type: transform',
      '    transform_type: sql',
      '    source: v_orders',
      '    sql_path: queries/nested/order.sql',
      '    depends_on:',
      '      - main.bronze.orders',
      '  - name: quality',
      '    type: test',
      '    test_type: uniqueness',
      '    source: v_orders',
      '  - name: publish',
      '    type: write',
      '    source: v_orders',
      '    write_target:',
      '      type: streaming_table',
    ].join('\n');
    const loadType = at(source, 'cloudfiles');
    expect(loadType.actionPath).toEqual(['actions', 0]);
    expect(loadType.actionType).toBe('load');
    expect(loadType.actionSubtype).toBe('cloudfiles');
    expect(referenceSuggestions('authoring', loadType, snapshot.catalog, index, snapshot)).toEqual(
      [],
    );
    const sqlPath = at(source, 'queries/nested/order.sql');
    expect(sqlPath.actionType).toBe('transform');
    expect(sqlPath.actionSubtype).toBe('sql');
    expect(
      referenceSuggestions('authoring', sqlPath, snapshot.catalog, index, snapshot).map(
        (value) => value.label,
      ),
    ).toContain('queries/nested/order.sql');
    expect(
      referenceSuggestions('authoring', sqlPath, snapshot.catalog, index, snapshot).map(
        (value) => value.label,
      ),
    ).not.toContain('py_functions/order.py');
    const moduleContext = yamlCursorContext(
      source.replace('sql_path: queries/nested/order.sql', 'module_path: py_functions/order.py'),
      source.indexOf('queries/nested/order.sql') + 4,
    );
    expect(
      referenceSuggestions('authoring', moduleContext, snapshot.catalog, index, snapshot).map(
        (value) => value.label,
      ),
    ).toEqual(['py_functions/order.py']);
    const dependency = at(source, 'main.bronze.orders');
    expect(dependency.path).toEqual(['actions', 1, 'depends_on', 0]);
    expect(
      referenceSuggestions('authoring', dependency, snapshot.catalog, index, snapshot).length,
    ).toBeGreaterThan(0);
    expect(at(source, 'uniqueness').actionSubtype).toBe('uniqueness');
    expect(at(source, 'streaming_table').actionSubtype).toBe('streaming_table');
  });

  it('never offers references in comments, block SQL or unrelated YAML', () => {
    const source = [
      'pipeline: bronze',
      'flowgroup: orders',
      'actions:',
      '  - name: clean',
      '    type: transform',
      '    transform_type: sql',
      '    sql: |',
      '      select "source: x" as value # comment',
      '    source: "v_orders # literal"',
      '    # source: v_ignore',
    ].join('\n');
    expect(at(source, 'source: x').suppressed).toBe(true);
    expect(at(source, 'v_ignore').suppressed).toBe(true);
    expect(at(source, 'v_orders # literal').suppressed).toBe(false);
    expect(at('source: &orders v_orders\ncopy: *orders\n', '*orders').suppressed).toBe(true);
    expect(
      classifyLhpYaml('other/databricks.yml', snapshot.catalog, index, snapshot),
    ).toBeUndefined();
    expect(
      classifyLhpYaml('templates/bundle/job_config.yaml', snapshot.catalog, index, snapshot),
    ).toBe('job_config');
    expect(
      classifyLhpYaml('templates/bundle/variables.yaml', snapshot.catalog, index, snapshot),
    ).toBeUndefined();
    expect(classifyLhpYaml('custom/orders.yaml', snapshot.catalog, index, snapshot)).toBe(
      'authoring',
    );
  });

  it('finds substitution tokens and cached parse contexts in incomplete drafts', () => {
    const source =
      'pipeline: bronze\nactions:\n  - name: ingest\n    type: load\n    source: ${landing_\n';
    const atOffset = analyzeYaml(source);
    const context = atOffset(source.indexOf('${landing_') + 5);
    expect(context.actionPath).toEqual(['actions', 0]);
    expect(
      substitutionSuggestions('authoring', context, index, 'dev').map((value) => value.label),
    ).toEqual(['landing_volume']);
    expect(substitutionSuggestions('authoring', context, index, 'prod')).toEqual([]);
    expect(atOffset(source.indexOf('bronze') + 1).path).toEqual(['pipeline']);
  });

  it('resolves template parameters to their exact enclosing instance in a list root', () => {
    const source = [
      '- pipeline: bronze',
      '  flowgroup: orders',
      '  use_template: csv_ingestion',
      '  template_parameters:',
      '    landing_folder: /landing/orders',
      '- pipeline: bronze',
      '  flowgroup: other',
      '  use_template: missing',
      '  template_parameters:',
      '    landing_folder: /other',
    ].join('\n');
    const first = at(source, 'landing_folder');
    const matched = parameterContext(source, first, catalog);
    expect(first.path).toEqual([0, 'template_parameters', 'landing_folder']);
    expect(matched?.definition).toBe('csv_ingestion');
    expect(matched?.field?.name).toBe('landing_folder');
    expect(matched?.source.path).toBe(snapshot.catalog.templates[0]?.source.path);
    const second = at(source, 'landing_folder', source.indexOf('missing'));
    expect(parameterContext(source, second, catalog)).toBeUndefined();
  });

  it('replaces dotted paths and only the current substitution token name', () => {
    const source =
      'sql_path: "queries/nested/old.name.sql"\nsource: ${landing_old}/orders/${schema_old}\n';
    const path = at(source, 'queries/nested/old.name.sql');
    const range = referenceReplacement(source, path)!;
    expect(
      source.slice(0, range.start) + 'queries/nested/new.name.sql' + source.slice(range.end),
    ).toContain('sql_path: "queries/nested/new.name.sql"');
    const first = at(source, 'landing_old');
    const firstRange = tokenReplacement(source, first, source.indexOf('landing_old') + 3)!;
    const replaced =
      source.slice(0, firstRange.start) + 'landing_volume' + source.slice(firstRange.end);
    expect(replaced).toContain('source: ${landing_volume}/orders/${schema_old}');
    const second = at(source, 'schema_old');
    const secondRange = tokenReplacement(source, second, source.indexOf('schema_old') + 3)!;
    expect(secondRange.start).toBeGreaterThan(firstRange.end);
  });

  it('builds action snippets from canonical catalogue defaults, not a fake subtype key', () => {
    const source = 'pipeline: bronze\nflowgroup: orders\nactions:\n  - \n';
    const context = at(source, '  - ');
    const originalDefaults = JSON.stringify(
      snapshot.catalog.actions.map((action) => action.defaults),
    );
    const snippets = actionSnippets('authoring', context, snapshot.catalog);
    expect(JSON.stringify(snapshot.catalog.actions.map((action) => action.defaults))).toBe(
      originalDefaults,
    );
    actionSnippets('authoring', context, snapshot.catalog);
    expect(JSON.stringify(snapshot.catalog.actions.map((action) => action.defaults))).toBe(
      originalDefaults,
    );
    expect(snippets.length).toBeGreaterThan(2);
    for (const snippet of snippets) {
      const ready = snippet.insertText!.replace(/\$\{\d+:[^}]*\}/g, 'example');
      const parsed = parseDocument(`actions:\n  ${ready.replace(/\n/g, '\n  ')}`);
      expect(parsed.errors).toEqual([]);
      expect(ready).not.toMatch(/\n\s+subtype:/);
    }
    expect(snippets.find((entry) => entry.label === 'Auto Loader (files)')?.insertText).toContain(
      'source:',
    );
    const first = snippets[0]!.insertText!;
    expect(snippetForLine(first, '  - ')).not.toMatch(/^- /);
    expect(snippetForLine(first, '  ')).toMatch(/^- /);
  });
});
