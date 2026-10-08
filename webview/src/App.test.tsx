import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostMessage, WebviewRequest } from '../../src/shared/protocol'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import { demoSnapshot } from './demoFixture'
import { App } from './App'

vi.mock('./components/GraphPanel', () => ({
  GraphPanel: ({ graph, onSelect }: { graph: { items: { id: string; name: string }[] }; onSelect: (id: string) => void }) =>
    <div aria-label="Mock graph">{graph.items.map((item) => <button key={item.id} onClick={() => onSelect(item.id)}>{item.name}</button>)}</div>,
}))

function emit(message: HostMessage) {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

describe('project graph navigation', () => {
  const posted = vi.fn<(message: WebviewRequest) => void>()
  beforeAll(() => {
    window.acquireVsCodeApi = () => ({ postMessage: posted, getState: () => undefined, setState: () => {} })
  })
  beforeEach(() => posted.mockClear())
  afterEach(cleanup)

  it('drills from pipeline to action graph and opens native action source once with context', async () => {
    render(<App />)
    emit({ type: 'bootstrap', protocolVersion: PROTOCOL_VERSION, projects: [demoSnapshot().context.project], snapshot: demoSnapshot(), trusted: true })
    await screen.findByText('bronze_load · flowgroups')
    fireEvent.click(screen.getAllByRole('button', { name: 'orders_bronze' })[0]!)
    await screen.findByText('orders_bronze · actions')
    fireEvent.click(screen.getByRole('button', { name: 'cleanse_orders' }))
    expect(screen.getByRole('heading', { name: 'cleanse_orders' })).toBeTruthy()
    const opens = posted.mock.calls.map(([message]) => message).filter((message) => message.type === 'openSource')
    expect(opens).toHaveLength(1)
    expect(opens[0]).toMatchObject({ context: { projectId: 'demo', revision: 7 }, source: { path: 'pipelines/bronze/orders_bronze.yaml', range: { start: { line: 18, character: 2 } } } })
    fireEvent.click(screen.getByRole('button', { name: /sql: sql\/cleanse_orders\.sql/ }))
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'openSource', source: { path: 'sql/cleanse_orders.sql' } })
  })

  it('keeps native undo available while invalid YAML pauses graph mutations', async () => {
    render(<App />)
    const snapshot = demoSnapshot('stale')
    emit({ type: 'bootstrap', protocolVersion: PROTOCOL_VERSION, projects: [snapshot.context.project], snapshot, trusted: true })
    await screen.findByText('bronze_load · flowgroups')
    fireEvent.click(screen.getAllByRole('button', { name: 'orders_bronze' })[0]!)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: /Add action/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/last valid project snapshot/)).toBeTruthy()
  })

  it('shows an actionable runtime setup state without invented project content', async () => {
    render(<App />)
    const snapshot = demoSnapshot('runtime')
    emit({ type: 'bootstrap', protocolVersion: PROTOCOL_VERSION, projects: [snapshot.context.project], snapshot, trusted: true })
    await waitFor(() => expect(screen.getByText(/LHP runtime unavailable or incompatible/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Choose interpreter' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Generate full project…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
