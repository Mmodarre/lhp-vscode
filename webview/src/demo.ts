import type { HostMessage, WebviewRequest } from '../../src/shared/protocol'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import { demoSnapshot } from './demoFixture'

const state = new URLSearchParams(location.search).get('state')
const variant = state === 'stale' || state === 'runtime' ? state : 'normal'
const empty = state === 'empty'
let snapshot = demoSnapshot(variant)
const emit = (message: HostMessage) => window.dispatchEvent(new MessageEvent('message', { data: message }))

window.acquireVsCodeApi = () => ({
  getState: () => undefined,
  setState: () => undefined,
  postMessage: (message: WebviewRequest) => {
    if (message.type === 'ready') {
      setTimeout(() => emit(empty
        ? { type: 'bootstrap', protocolVersion: PROTOCOL_VERSION, projects: [], trusted: true }
        : { type: 'bootstrap', protocolVersion: PROTOCOL_VERSION, projects: [snapshot.context.project], snapshot, trusted: true }), 0)
      return
    }
    if (message.type === 'selectEnvironment') {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, context: { ...snapshot.context, environment: message.environment } }
      emit({ type: 'snapshot', snapshot })
    }
    if (message.type === 'preview') {
      emit({ type: 'preview', result: { parity: 'source-only', documentVersions: Object.fromEntries(snapshot.documents.map((doc) => [doc.path, doc.version])),
        files: [{ path: 'generated/dev/bronze_load/orders_bronze.py', kind: 'python', pipeline: 'bronze_load', content: '# Preview of generated source\n' }], notices: ['Demo preview only.'] } })
    }
    setTimeout(() => emit({ type: 'result', requestId: message.requestId, success: true, message: `Demo: ${message.type} request received.` }), 20)
  },
})

void import('./main')
