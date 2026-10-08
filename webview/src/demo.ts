import type { HostMessage, WebviewRequest } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { demoSnapshot } from './demoFixture';

const state = new URLSearchParams(location.search).get('state');
const variant = state === 'stale' || state === 'runtime' ? state : 'normal';
const empty = state === 'empty';
let snapshot = demoSnapshot(variant);
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
                }
              : {
                  type: 'bootstrap',
                  protocolVersion: PROTOCOL_VERSION,
                  projects: [snapshot.context.project],
                  snapshot,
                  trusted: true,
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
