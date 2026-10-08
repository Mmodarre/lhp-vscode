import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSnapshot } from '../demoFixture'
import { ActionInspector } from './ActionInspector'
import { FlowgroupInspector } from './FlowgroupInspector'

afterEach(cleanup)

describe('inspector drafts across document snapshots', () => {
  it('acknowledges its own action edit, permits a second edit, and protects a distinct local draft', async () => {
    const snapshot = demoSnapshot()
    const detail = snapshot.flowgroups[0]!
    const action = detail.actions[0]!
    const onMutate = vi.fn()
    const props = { detail, catalog: snapshot.catalog, canEditGraph: true, onOpen: vi.fn(), onMutate }
    const view = render(<ActionInspector {...props} action={action} />)
    fireEvent.change(screen.getByLabelText(/Landing path/), { target: { value: '/incoming/first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to YAML' }))
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'configure', values: expect.objectContaining({ source: expect.objectContaining({ path: '/incoming/first' }) }) }))
    const first = { ...action, raw: { ...action.raw, source: { ...(action.raw.source as object), path: '/incoming/first' } } }
    view.rerender(<ActionInspector {...props} action={first} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Apply to YAML' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText(/Landing path/), { target: { value: '/incoming/second' } })
    expect((screen.getByRole('button', { name: 'Apply to YAML' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Apply to YAML' }))
    expect(onMutate).toHaveBeenCalledTimes(2)
    const second = { ...first, raw: { ...first.raw, source: { ...(first.raw.source as object), path: '/incoming/second' } } }
    view.rerender(<ActionInspector {...props} action={second} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Apply to YAML' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText(/Landing path/), { target: { value: '/local/draft' } })
    const external = { ...second, raw: { ...second.raw, source: { ...(second.raw.source as object), path: '/external/change' } } }
    view.rerender(<ActionInspector {...props} action={external} />)
    expect(await screen.findByText(/document changed while this form had unsaved edits/)).toBeTruthy()
    expect((screen.getByLabelText(/Landing path/) as HTMLInputElement).value).toBe('/local/draft')
    expect((screen.getByRole('button', { name: 'Apply to YAML' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('acknowledges its own instance-parameter edit and preserves a draft on external changes', async () => {
    const snapshot = demoSnapshot()
    const detail = snapshot.flowgroups.find((item) => item.id === 'inventory')!
    const onMutate = vi.fn()
    const props = { catalog: snapshot.catalog, canEditGraph: true, onOpen: vi.fn(), onMutate, onShowActions: vi.fn() }
    const view = render(<FlowgroupInspector {...props} detail={detail} />)
    fireEvent.change(screen.getByLabelText(/Landing folder/), { target: { value: 'inventory-v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply parameters to YAML' }))
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'configureFlowgroup', values: expect.objectContaining({ template_parameters: { landing_folder: 'inventory-v2' } }) }))
    const first = { ...detail, raw: { ...detail.raw, template_parameters: { landing_folder: 'inventory-v2' } } }
    view.rerender(<FlowgroupInspector {...props} detail={first} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Apply parameters to YAML' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText(/Landing folder/), { target: { value: 'inventory-v3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply parameters to YAML' }))
    expect(onMutate).toHaveBeenCalledTimes(2)
    const second = { ...first, raw: { ...first.raw, template_parameters: { landing_folder: 'inventory-v3' } } }
    view.rerender(<FlowgroupInspector {...props} detail={second} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Apply parameters to YAML' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText(/Landing folder/), { target: { value: 'my-local-draft' } })
    const external = { ...second, raw: { ...second.raw, template_parameters: { landing_folder: 'other-writer' } } }
    view.rerender(<FlowgroupInspector {...props} detail={external} />)
    expect(await screen.findByText(/instance YAML changed while these parameters were being edited/)).toBeTruthy()
    expect((screen.getByLabelText(/Landing folder/) as HTMLInputElement).value).toBe('my-local-draft')
    expect((screen.getByRole('button', { name: 'Apply parameters to YAML' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
