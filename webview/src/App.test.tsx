import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, ProjectDatasetIndex, WebviewRequest } from '../../src/shared/protocol';
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

  it('shows the canonical sandbox scope, filters pipeline choices, and treats Show all as display only', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    snapshot.sandbox = {
      mode: 'on',
      display: 'selected',
      profilePath: '.lhp/profile.yaml',
      profileExists: true,
      profileSource: 'saved',
      namespace: 'alice',
      patterns: ['silver_curate'],
      selectedPipelines: ['silver_curate'],
      totalPipelines: 2,
      allowedEnvironments: ['dev'],
      environment: 'dev',
      valid: true,
      stale: false,
      scopeComplete: true,
      previewParity: 'source-only',
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    expect(await screen.findByText('Sandbox On')).toBeTruthy();
    expect(screen.getByText(/1 of 2 pipelines/)).toBeTruthy();
    expect(screen.getByText('silver_curate · flowgroups')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate sandbox profile…' })).toBeTruthy();
    expect(screen.queryByText('bronze_load · flowgroups')).toBeNull();
    fireEvent.change(screen.getByLabelText('Pipeline display'), { target: { value: 'all' } });
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'setPipelineDisplay',
      display: 'all',
    });
    emit({
      type: 'sandbox',
      projectId: 'demo',
      revision: snapshot.revision,
      sandbox: { ...snapshot.sandbox, display: 'all' },
    });
    expect(await screen.findByText('bronze_load · flowgroups')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate sandbox profile…' })).toBeTruthy();
  });

  it('labels draft profile generation unavailable and routes known source usages to the host', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    snapshot.sandbox = {
      mode: 'on',
      display: 'selected',
      profilePath: '.lhp/profile.yaml',
      profileExists: true,
      profileSource: 'draft',
      namespace: 'alice',
      patterns: ['bronze_load'],
      selectedPipelines: ['bronze_load'],
      totalPipelines: 2,
      allowedEnvironments: ['dev'],
      environment: 'dev',
      valid: true,
      stale: false,
      scopeComplete: true,
      previewParity: 'source-only',
    };
    snapshot.resourceUsages = {
      'sql/cleanse_orders.sql': {
        knownUseCount: 2,
        usageComplete: false,
        knownLabels: ['orders_bronze', 'customers_bronze'],
      },
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    expect(await screen.findByText('Unsaved profile draft')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Generate sandbox profile…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(await screen.findByText('cleanse_orders.sql')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2 uses+' }));
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'showUsages',
      path: 'sql/cleanse_orders.sql',
    });
  });

  it('keeps routine successful results out of the full-width notice area', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const firstRequest = posted.mock.calls.at(-1)?.[0];
    if (!firstRequest) throw new Error('Refresh request was not posted.');
    emit({ type: 'result', requestId: firstRequest.requestId, success: true });
    expect(screen.queryByText('Done.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const secondRequest = posted.mock.calls.at(-1)?.[0];
    if (!secondRequest) throw new Error('Second refresh request was not posted.');
    emit({
      type: 'result',
      requestId: secondRequest.requestId,
      success: true,
      message: 'Bundle generated.',
    });
    expect(await screen.findByText('Bundle generated.')).toBeTruthy();
  });

  it('labels an inherited flowgroup instance once and never calls direct source an instance', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    const direct = snapshot.pipelines[0]?.flowgroups[0];
    if (direct) direct.origin.instance = direct.source;
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    expect(screen.getByRole('button', { name: 'Open source YAML' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open instance YAML' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'inventory_ingestion' }));
    expect(screen.getAllByRole('button', { name: /^Open instance YAML/ })).toHaveLength(1);
  });

  it('does not replace an explicitly selected flowgroup after refresh removes it', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getByRole('button', { name: 'orders_bronze' }));
    await screen.findByText('orders_bronze · actions');
    emit({
      type: 'snapshot',
      snapshot: {
        ...snapshot,
        revision: 8,
        flowgroups: snapshot.flowgroups.filter((group) => group.id !== 'orders'),
        pipelines: snapshot.pipelines.map((pipeline) => ({
          ...pipeline,
          flowgroups: pipeline.flowgroups.filter((group) => group.id !== 'orders'),
        })),
      },
    });
    expect(await screen.findAllByText('Selected flowgroup no longer exists')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Open owning YAML' })).toBeNull();
    expect(screen.queryByText('customers_bronze · actions')).toBeNull();
  });

  it('requires a new pipeline choice when the selected pipeline disappears', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.change(screen.getByLabelText('Pipeline'), { target: { value: 'silver_curate' } });
    await screen.findByText('silver_curate · flowgroups');
    emit({
      type: 'snapshot',
      snapshot: {
        ...snapshot,
        revision: 8,
        pipelines: snapshot.pipelines.filter((pipeline) => pipeline.name !== 'silver_curate'),
      },
    });
    expect(await screen.findAllByText('Selected pipeline no longer exists')).toHaveLength(2);
    expect((screen.getByLabelText('Pipeline') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('bronze_load · flowgroups')).toBeNull();
  });

  it('keeps Data lineage selected when a declared owner is absent from the graph', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getByRole('button', { name: 'Data lineage' }));
    emit({
      type: 'datasets',
      datasets: {
        projectId: snapshot.context.project.id,
        revision: snapshot.revision,
        environment: snapshot.context.environment,
        stale: false,
        warnings: [],
        edges: [],
        datasets: [
          {
            id: 'declared-orders',
            name: 'main.bronze.orders',
            kind: 'table',
            upstream: [],
            downstream: [],
            consumers: [],
            producers: [
              {
                label: 'bronze_load / removed / load',
                source: { path: 'pipelines/bronze/orders.yaml' },
                pipeline: 'bronze_load',
                flowgroupId: 'removed',
                actionId: 'removed:load',
              },
            ],
          },
        ],
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'main.bronze.orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show action graph' }));
    expect(
      await screen.findByText(/dataset owner is no longer in the current project graph/i),
    ).toBeTruthy();
    expect(screen.getByText('Declared data lineage')).toBeTruthy();
  });

  it('ignores late result and error feedback from a previous project', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    const next = {
      ...snapshot,
      revision: 8,
      context: {
        ...snapshot.context,
        project: { ...snapshot.context.project, id: 'other', name: 'other' },
      },
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project, next.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const oldRequest = posted.mock.calls.at(-1)?.[0];
    if (!oldRequest) throw new Error('Old-project request was not posted.');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'other' } });
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project, next.context.project],
      snapshot: next,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const currentRequest = posted.mock.calls.at(-1)?.[0];
    if (!currentRequest) throw new Error('Current-project request was not posted.');
    emit({
      type: 'error',
      requestId: currentRequest.requestId,
      code: 'HOST_ERROR',
      message: 'Current project needs attention.',
      recoverable: true,
    });
    await screen.findByText('Current project needs attention.');
    emit({ type: 'result', requestId: oldRequest.requestId, success: true });
    emit({
      type: 'error',
      requestId: oldRequest.requestId,
      code: 'HOST_ERROR',
      message: 'Old project failed.',
      recoverable: true,
    });
    expect(screen.getByText('Current project needs attention.')).toBeTruthy();
    expect(screen.queryByText('Old project failed.')).toBeNull();
  });

  it('keeps execution controls disabled in an untrusted project', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    snapshot.context.trusted = false;
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: false,
    });
    await screen.findByText('bronze_load · flowgroups');
    expect((screen.getByLabelText('Environment') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Data lineage' }));
    expect(posted.mock.calls.map(([message]) => message.type)).not.toContain('loadData');
    expect(
      (screen.getByRole('button', { name: 'Load lineage' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

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

  it('focuses a sidebar selection only in its matching project and graph revision', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
      selection: {
        projectId: 'demo',
        revision: 7,
        pipeline: 'bronze_load',
        flowgroupId: 'orders',
        actionId: 'orders:cleanse',
      },
    });
    await screen.findByText('orders_bronze · actions');
    expect(screen.getByRole('heading', { name: 'cleanse_orders' })).toBeTruthy();
    expect(posted.mock.calls.map(([message]) => message.type)).not.toContain('openSource');

    emit({
      type: 'select',
      selection: { projectId: 'demo', revision: 6, pipeline: 'silver_curate' },
    });
    await waitFor(() => expect(screen.getByText('orders_bronze · actions')).toBeTruthy());
    emit({
      type: 'select',
      selection: { projectId: 'another-project', revision: 7, pipeline: 'silver_curate' },
    });
    await waitFor(() => expect(screen.getByText('orders_bronze · actions')).toBeTruthy());
    emit({
      type: 'select',
      selection: { projectId: 'demo', revision: 7, pipeline: 'silver_curate' },
    });
    await screen.findByText('silver_curate · flowgroups');
  });

  it('clears the previous project graph when a new project bootstraps before loading', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [{ id: 'second', name: 'Second', rootLabel: 'second/' }],
      trusted: true,
    });
    await waitFor(() => expect(screen.queryByText('bronze_load · flowgroups')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Choose an LHP project' })).toBeTruthy();
  });

  it('resets a prior action selection when another project arrives with a ready snapshot', async () => {
    render(<App />);
    const first = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [first.context.project],
      snapshot: first,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    fireEvent.click(screen.getAllByRole('button', { name: 'orders_bronze' })[0]!);
    await screen.findByText('orders_bronze · actions');
    fireEvent.click(screen.getByRole('button', { name: 'load_orders' }));
    await screen.findByRole('heading', { name: 'load_orders' });
    const second = {
      ...demoSnapshot(),
      revision: 1,
      context: { ...first.context, project: { id: 'other', name: 'Other', rootLabel: 'other/' } },
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [second.context.project],
      snapshot: second,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    expect(screen.queryByText('orders_bronze · actions')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'load_orders' })).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const refreshRequest = posted.mock.calls.at(-1)?.[0];
    if (!refreshRequest) throw new Error('Refresh request was not posted.');
    emit({
      type: 'error',
      requestId: refreshRequest.requestId,
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

  it('keeps duplicate graph navigation collapsed and opens the project map from the editor', async () => {
    render(<App />);
    const snapshot = {
      ...demoSnapshot(),
      pipelineEdges: [
        {
          id: 'p-edge',
          source: 'bronze_load',
          target: 'silver_curate',
          dataset: 'orders',
          editable: false,
        },
      ],
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
      logoUri: 'vscode-resource://lhp/media/lhp-mark.svg',
    });
    await screen.findByText('bronze_load · flowgroups');
    expect(document.querySelector('.brand-logo')?.getAttribute('src')).toContain('lhp-mark.svg');
    expect(screen.queryByRole('navigation', { name: 'Browse project graphs' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(screen.getByRole('navigation', { name: 'Browse project graphs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close browse panel' }));
    expect(screen.queryByRole('navigation', { name: 'Browse project graphs' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Project map' }));
    await screen.findByText('Project dependency map');
    fireEvent.click(screen.getByRole('button', { name: 'silver_curate' }));
    await screen.findByText('silver_curate · flowgroups');
  });

  it('shows declared lineage and external ownership without opening an invented source', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    const datasets: ProjectDatasetIndex = {
      projectId: 'demo',
      revision: 7,
      environment: snapshot.context.environment,
      stale: false,
      warnings: [],
      edges: [],
      datasets: [
        {
          id: 'external.orders',
          name: 'landing.orders',
          kind: 'external',
          producers: [],
          consumers: [
            {
              label: 'load_orders',
              source: {
                path: 'pipelines/bronze/orders_bronze.yaml',
                documentIndex: 1,
                yamlPath: ['actions', 0],
              },
              pipeline: 'bronze_load',
              flowgroupId: 'orders',
              actionId: 'orders:load',
            },
          ],
          upstream: [],
          downstream: [],
        },
      ],
    };
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      datasets,
      trusted: true,
      selection: { projectId: 'demo', revision: 7, view: 'dataset', datasetId: 'external.orders' },
    });
    await screen.findByText('Declared data lineage');
    expect(screen.getByText(/no live warehouse query/i)).toBeTruthy();
    expect(screen.getByText(/does not own a local definition/)).toBeTruthy();
    expect(posted.mock.calls.map(([message]) => message.type)).not.toContain('openSource');
    fireEvent.click(
      screen.getByRole('button', { name: 'Open pipelines/bronze/orders_bronze.yaml' }),
    );
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'openSource',
      source: { path: 'pipelines/bronze/orders_bronze.yaml', documentIndex: 1 },
    });
  });

  it('loads lineage only on demand and does not reuse it after a source revision changes', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    expect(posted.mock.calls.map(([message]) => message.type)).not.toContain('loadData');
    fireEvent.click(screen.getByRole('button', { name: 'Data lineage' }));
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'loadData',
      context: { projectId: 'demo', revision: 7 },
    });
    expect(screen.getByText('Data lineage has not loaded')).toBeTruthy();
    emit({
      type: 'datasets',
      datasets: {
        projectId: 'demo',
        revision: 7,
        environment: snapshot.context.environment,
        stale: false,
        warnings: [],
        datasets: [
          {
            id: 'a',
            name: 'synthetic.table',
            kind: 'table',
            producers: [],
            consumers: [],
            upstream: [],
            downstream: [],
          },
        ],
        edges: [],
      },
    });
    await screen.findByText('synthetic.table');
    emit({ type: 'snapshot', snapshot: { ...snapshot, revision: 8 } });
    await screen.findByText('Data lineage has not loaded');
    expect(screen.queryByText('synthetic.table')).toBeNull();
  });

  it('routes native guide messages to the chosen definition and guarded flowgroup creation', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    emit({
      type: 'guide',
      projectId: 'demo',
      revision: 7,
      guide: 'template',
      definition: 'csv_ingestion',
    });
    await screen.findByRole('heading', { name: 'New template instance' });
    expect((screen.getByLabelText(/Template/) as HTMLSelectElement).value).toBe('csv_ingestion');
    emit({ type: 'guide', projectId: 'demo', revision: 7, guide: 'flowgroup' });
    await screen.findByRole('heading', { name: 'New flowgroup' });
    fireEvent.change(screen.getByLabelText(/Flowgroup name/), {
      target: { value: 'first_bronze' },
    });
    fireEvent.change(screen.getByLabelText(/Pipeline name/), { target: { value: 'bronze_load' } });
    fireEvent.change(screen.getByLabelText(/New YAML path/), {
      target: { value: '../outside.yaml' },
    });
    expect(
      (screen.getByRole('button', { name: 'Create flowgroup' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/New YAML path/), {
      target: { value: 'pipelines/bronze/first.yaml' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create flowgroup' }));
    expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'createFlowgroup',
      context: { projectId: 'demo', revision: 7 },
      values: {
        name: 'first_bronze',
        pipeline: 'bronze_load',
        targetPath: 'pipelines/bronze/first.yaml',
      },
    });
  });

  it('waits for the matching project revision before opening a native resource guide', async () => {
    render(<App />);
    const snapshot = demoSnapshot();
    emit({
      type: 'bootstrap',
      protocolVersion: PROTOCOL_VERSION,
      projects: [snapshot.context.project],
      snapshot,
      trusted: true,
    });
    await screen.findByText('bronze_load · flowgroups');
    emit({ type: 'guide', projectId: 'other', revision: 7, guide: 'blueprint' });
    expect(screen.queryByRole('heading', { name: 'New blueprint instance' })).toBeNull();
    emit({
      type: 'guide',
      projectId: 'demo',
      revision: 8,
      guide: 'template',
      definition: 'csv_ingestion',
    });
    expect(screen.queryByRole('heading', { name: 'New template instance' })).toBeNull();
    emit({ type: 'snapshot', snapshot: { ...snapshot, revision: 8 } });
    await screen.findByRole('heading', { name: 'New template instance' });
    emit({ type: 'guide', projectId: 'demo', revision: 7, guide: 'flowgroup' });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'New flowgroup' })).toBeNull(),
    );
  });
});
