import { expect, it } from 'vitest';
import { generatedProvenance } from '../../src/generatedProvenance';
import { normalizeSnapshot } from '../../src/snapshot';

it('links only the exact successful source-mode pipeline/flowgroup and omits ambiguous or wheel artifacts', () => {
  const snapshot = normalizeSnapshot(
    '/project',
    {
      flowgroups: ['orders', 'customers'].map((name) => ({
        pipeline: 'bronze',
        name,
        source: { path: `pipelines/${name}.yaml` },
        actions: [],
        raw: {},
      })),
    },
    {
      project: { id: 'p', name: 'p', rootLabel: 'p' },
      environment: 'dev',
      environments: ['dev'],
      trusted: true,
      runtime: { compatible: true, interpreter: 'python', capabilities: [] },
    },
    1,
  );
  const response = {
    editor_packaging: { bronze: 'source' },
    pipeline_responses: {
      bronze: {
        success: true,
        output_location: '/project/generated/dev',
        generated_filenames: ['orders.py', 'customers.py', 'runner.py', 'package.whl'],
      },
    },
  };
  const sources = generatedProvenance('/project', response, snapshot);
  expect(Object.keys(sources)).toEqual([
    'generated/dev/bronze/orders.py',
    'generated/dev/bronze/customers.py',
  ]);
  expect(sources['generated/dev/bronze/orders.py']?.map((source) => source.source.path)).toEqual([
    'pipelines/orders.yaml',
  ]);
  expect(
    generatedProvenance(
      '/project',
      { ...response, editor_packaging: { bronze: 'wheel' } },
      snapshot,
    ),
  ).toEqual({});
  expect(generatedProvenance('/project', { ...response, editor_packaging: {} }, snapshot)).toEqual(
    {},
  );
});
