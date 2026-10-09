import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphModel } from '../model';
import { GraphPanel } from './GraphPanel';

const { fitView } = vi.hoisted(() => ({ fitView: vi.fn() }));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
  useNodesInitialized: () => true,
  useReactFlow: () => ({ fitView }),
}));

const item = (id: string) => ({ id, name: id, kicker: 'Action', detail: '', readonly: false });
const graph = (ids: string[], edges: GraphModel['edges'] = []): GraphModel => ({
  items: ids.map(item),
  edges,
});

describe('graph viewport', () => {
  beforeEach(() => {
    fitView.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('refits when graph nodes or dependency layout change but not on selection alone', () => {
    const onSelect = vi.fn();
    const props = {
      onSelect,
      emptyTitle: 'Empty',
      emptyDescription: 'No nodes',
    };
    const { rerender } = render(<GraphPanel {...props} graph={graph(['flowgroup'])} />);
    expect(fitView).toHaveBeenCalledTimes(1);

    const actions = graph(['load', 'write']);
    rerender(<GraphPanel {...props} graph={actions} />);
    expect(fitView).toHaveBeenCalledTimes(2);

    rerender(<GraphPanel {...props} graph={actions} selectedId="load" />);
    expect(fitView).toHaveBeenCalledTimes(2);

    rerender(
      <GraphPanel
        {...props}
        graph={graph(
          ['load', 'write'],
          [
            {
              id: 'load-write',
              source: 'load',
              target: 'write',
              dataset: 'v_orders',
              editable: true,
            },
          ],
        )}
        selectedId="load"
      />,
    );
    expect(fitView).toHaveBeenCalledTimes(3);
  });
});
