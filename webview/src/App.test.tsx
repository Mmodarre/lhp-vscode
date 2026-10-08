import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, WebviewRequest } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { demoSnapshot } from './demoFixture';
import { App } from './App';

vi.mock('./components/GraphPanel', () => ({
  GraphPanel: ({
    graph,
    onSelect,
  }: {
    graph: { items: { id: string; name: string }[] };
    onSelect: (id: string) => void;
  }) => (
    <div aria-label="Mock graph">
      {graph.items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item.id)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}));

function emit(message: HostMessage) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

describe('project graph navigation', () => {
  const posted = vi.fn<(message: WebviewRequest) => void>();
  beforeAll(() => {
    window.acquireVsCodeApi = () => ({
      postMessage: posted,
      getState: () => undefined,
      setState: () => {},
    });
  });
  beforeEach(() => posted.mockClear());
  afterEach(cleanup);

  it('drills from pipeline to action graph and opens native action source once with context', async () => {
    render(<App />);
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [demoSnapshot().context.project],
      snapshot: demoSnapshot(),
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getAllByRole('button', { name: 'orders_bronze' })[0]!);
    await screen.findByText('orders_bronze · actions');
    fireEvent.click(screen.getByRole('button', { name: 'cleanse_orders' }));
    expect(screen.getByRole('heading', { name: 'cleanse_orders' })).toBeTruthy();
    const opens = posted.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'openSource');
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      context: { projectId: 'demo', revision: 7 },
      source: {
        path: 'pipelines/bronze/orders_bronze.yaml',
        range: { start: { line: 18, character: 2 } },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /sql: sql\/cleanse_orders\.sql/ }));
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'openSource',
      source: { path: 'sql/cleanse_orders.sql' },
    });
  });

  it('keeps native undo available while invalid YAML pauses graph mutations', async () => {
    render(<App />);
    const snapshot = demoSnapshot('stale');
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getAllByRole('button', { name: 'orders_bronze' })[0]!);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: /Add action/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Generate full project…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/last valid project snapshot/)).toBeTruthy();
  });

  it('shows an actionable runtime setup state without invented project content', async () => {
    render(<App />);
    const snapshot = {
      ...demoSnapshot('runtime'),
      pipelines: [],
      flowgroups: [],
      flowgroupEdges: [],
      stale: true,
      diagnostics: demoSnapshot('stale').diagnostics,
      notices: ['Source changed. Refreshing the graph…'],
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await waitFor(() =>
      expect(
        screen.getByText(/selected Python cannot load the LHP editor integration/),
      ).toBeTruthy(),
    );
    expect(screen.getByText('/demo/python')).toBeTruthy();
    expect(screen.getByText('Pipeline graph unavailable')).toBeTruthy();
    expect(screen.queryByText(/Fix YAML errors/)).toBeNull();
    expect(screen.queryByText(/Source changed\. Refreshing/)).toBeNull();
    expect(screen.queryByText('Stale graph')).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose interpreter' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Validate' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Generate full project…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    emit({
      type: 'error',
      code: 'PROTOCOL_LIMIT',
      message: 'Previous transport failure.',
      recoverable: true,
    });
    await screen.findByText('Previous transport failure.');
    emit({
      type: 'snapshot',
      snapshot: { ...demoSnapshot(), revision: 10, refreshState: 'ready' },
    });
    await waitFor(() => expect(screen.queryByText('Previous transport failure.')).toBeNull());
    expect(screen.getByText('bronze_load · flowgroups')).toBeTruthy();
  });

  it('replaces an old runtime warning with a refresh failure while retaining the last graph', async () => {
    render(<App />);
    const old = { ...demoSnapshot('runtime'), stale: true };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [old.context.project],
      snapshot: old,
      trusted: true,
    });
    await screen.findByText(/selected Python cannot load/);
    const loading = {
      ...demoSnapshot(),
      revision: 8,
      stale: true,
      refreshState: 'loading' as const,
      context: {
        ...demoSnapshot().context,
        runtime: { ...demoSnapshot().context.runtime, interpreter: '/demo/current-python' },
      },
    };
    emit({ type: 'snapshot', snapshot: loading });
    await screen.findByText(/Refreshing this project's graph/);
    expect(screen.queryByText(/selected Python cannot load/)).toBeNull();
    const failed = {
      ...loading,
      revision: 9,
      refreshState: 'failed' as const,
      refreshError: 'LHP response exceeded the 32 MB transport limit.',
    };
    emit({ type: 'snapshot', snapshot: failed });
    await screen.findByText(/project graph could not refresh/);
    expect(screen.getByText(/32 MB transport limit/)).toBeTruthy();
    expect(screen.getByText('/demo/current-python')).toBeTruthy();
    expect(screen.getByText('bronze_load · flowgroups')).toBeTruthy();
    expect(screen.queryByText(/Fix YAML errors/)).toBeNull();
    expect(screen.queryByText(/selected Python cannot load/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Generate full project…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('keeps a large informational notice set accessible without covering the graph', async () => {
    render(<App />);
    const snapshot = {
      ...demoSnapshot(),
      notices: Array.from({ length: 84 }, (_, index) => `External dataset: synthetic_${index}`),
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    expect(screen.getByText(/84 project notices/)).toBeTruthy();
    expect(screen.queryByText('External dataset: synthetic_0')).toBeNull();
    const reveal = screen.getByRole('button', { name: 'Show details' });
    expect(reveal.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(reveal);
    expect(screen.getByRole('region', { name: 'Project notices' })).toBeTruthy();
    expect(screen.getByText('External dataset: synthetic_0')).toBeTruthy();
    expect(screen.getByText('External dataset: synthetic_83')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});
