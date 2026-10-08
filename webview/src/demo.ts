import type { HostMessage, ProjectDatasetIndex, WebviewRequest } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { demoSnapshot } from './demoFixture';

const state = new URLSearchParams(location.search).get('state');
const variant = state === 'stale' || state === 'runtime' ? state : 'normal';
const empty = state === 'empty';
let snapshot = demoSnapshot(variant);
snapshot = {
  ...snapshot,
  pipelineEdges: [
    {
      id: 'demo-pipeline-edge',
      source: 'bronze_load',
      target: 'silver_curate',
      dataset: 'orders',
      editable: false,
    },
  ],
};
const demoDatasets: ProjectDatasetIndex = {
  projectId: snapshot.context.project.id,
  revision: snapshot.revision,
  environment: snapshot.context.environment,
  stale: false,
  warnings: [],
  datasets: [
    {
      id: 'external:orders',
      name: 'landing.orders',
      kind: 'external',
      producers: [],
      consumers: [
        {
          label: 'load_orders',
          source: {
            path: 'pipelines/bronze/orders_bronze.yaml',
            range: { start: { line: 7, character: 2 }, end: { line: 8, character: 0 } },
          },
          pipeline: 'bronze_load',
          flowgroupId: 'orders',
          actionId: 'orders:load',
        },
      ],
      upstream: [],
      downstream: ['view:orders'],
    },
    {
      id: 'view:orders',
      name: 'v_orders_raw',
      kind: 'table',
      producers: [
        {
          label: 'load_orders',
          source: { path: 'pipelines/bronze/orders_bronze.yaml' },
          pipeline: 'bronze_load',
          flowgroupId: 'orders',
          actionId: 'orders:load',
        },
      ],
      consumers: [
        {
          label: 'cleanse_orders',
          source: { path: 'pipelines/bronze/orders_bronze.yaml' },
          pipeline: 'bronze_load',
          flowgroupId: 'orders',
          actionId: 'orders:cleanse',
        },
      ],
      upstream: ['external:orders'],
      downstream: [],
    },
  ],
  edges: [
    {
      id: 'landing-to-raw',
      source: 'external:orders',
      target: 'view:orders',
      dataset: 'orders',
      editable: false,
    },
  ],
};
if (state === 'runtime')
  snapshot = {
    ...snapshot,
    pipelines: [],
    flowgroups: [],
    flowgroupEdges: [],
    documents: [],
    diagnostics: [],
    notices: [],
    stale: false,
  };
if (state === 'failed')
  snapshot = {
    ...snapshot,
    refreshState: 'failed',
    refreshError: 'Synthetic transport failure while loading the current project.',
    stale: true,
    diagnostics: [],
    notices: [],
  };
if (state === 'notices')
  snapshot = {
    ...snapshot,
    notices: Array.from({ length: 84 }, (_, index) => `External dataset: synthetic_${index}`),
  };
if (state === 'large') {
  const prototype = snapshot.pipelines[0]?.flowgroups[0];
  if (prototype) {
    const summaries = Array.from({ length: 4017 }, (_, index) => ({
      ...prototype,
      id: `synthetic-${index}`,
      name: `synthetic_flowgroup_${index}`,
      source: { path: `pipelines/synthetic_${index}.yaml` },
    }));
    snapshot = {
      ...snapshot,
      pipelines: [{ ...snapshot.pipelines[0]!, flowgroups: summaries }],
      flowgroupEdges: summaries.flatMap((item, index) =>
        index % 6 === 5 || !summaries[index + 1]
          ? []
          : [
              {
                id: `synthetic-edge-${index}`,
                source: item.id,
                target: summaries[index + 1]!.id,
                dataset: `synthetic_view_${index}`,
                editable: false,
              },
            ],
      ),
    };
  }
}
const emit = (message: HostMessage) =>
  window.dispatchEvent(new MessageEvent('message', { data: message }));
const logoUri = new URL('../media/lhp-mark.svg', location.href).toString();

window.acquireVsCodeApi = () => ({
  getState: () => undefined,
  setState: () => undefined,
  postMessage: (message: WebviewRequest) => {
    if (message.type === 'ready') {
      setTimeout(
        () =>
          emit(
            empty
              ? {
                  type: 'bootstrap',
                  protocolVersion: PROTOCOL_VERSION,
                  projects: [],
                  trusted: true,
                  logoUri,
                }
              : {
                  type: 'bootstrap',
                  protocolVersion: PROTOCOL_VERSION,
                  projects: [snapshot.context.project],
                  snapshot,
                  trusted: true,
                  logoUri,
                  datasets: demoDatasets,
                  selection:
                    state === 'project'
                      ? {
                          projectId: snapshot.context.project.id,
                          revision: snapshot.revision,
                          view: 'project',
                        }
                      : state === 'data'
                        ? {
                            projectId: snapshot.context.project.id,
                            revision: snapshot.revision,
                            view: 'dataset',
                            datasetId: 'view:orders',
                          }
                        : undefined,
                },
          ),
        0,
      );
      return;
    }
    if (message.type === 'selectEnvironment') {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        context: { ...snapshot.context, environment: message.environment },
      };
      emit({ type: 'snapshot', snapshot });
    }
    if (message.type === 'preview') {
      emit({
        type: 'preview',
        result: {
          parity: 'source-only',
          documentVersions: Object.fromEntries(
            snapshot.documents.map((doc) => [doc.path, doc.version]),
          ),
          files: [
            {
              path: 'generated/dev/bronze_load/orders_bronze.py',
              kind: 'python',
              pipeline: 'bronze_load',
              content: '# Preview of generated source\n',
            },
          ],
          notices: ['Demo preview only.'],
        },
      });
    }
    if (message.type === 'loadData') emit({ type: 'datasets', datasets: demoDatasets });
    setTimeout(
      () =>
        emit({
          type: 'result',
          requestId: message.requestId,
          success: true,
          message: `Demo: ${message.type} request received.`,
        }),
      20,
    );
  },
});

void import('./main');
