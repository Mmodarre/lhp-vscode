import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../demoFixture';
import { InstanceWizard } from './InstanceWizard';

afterEach(cleanup);

describe('reusable definition instances', () => {
  it('creates a blueprint invocation from its required parameter and new YAML path without unused flowgroup fields', () => {
    const create = vi.fn();
    render(
      <InstanceWizard
        kind="blueprint"
        catalog={demoSnapshot().catalog}
        pipelines={['bronze_load']}
        busy={false}
        onCancel={vi.fn()}
        onCreate={create}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Instance name/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/New instance YAML path/), {
      target: { value: 'pipelines/orders.yaml' },
    });
    fireEvent.change(screen.getByLabelText(/Source path/), {
      target: { value: '/Volumes/landing/orders/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create blueprint instance' }));
    expect(create).toHaveBeenCalledWith({
      kind: 'blueprint',
      definition: 'system_bronze',
      name: '',
      pipeline: '',
      targetPath: 'pipelines/orders.yaml',
      parameters: { source_path: '/Volumes/landing/orders/' },
    });
  });
});
