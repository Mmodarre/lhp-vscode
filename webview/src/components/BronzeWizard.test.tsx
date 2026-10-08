import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BronzeWizard } from './BronzeWizard'

describe('files-to-bronze guide', () => {
  afterEach(cleanup)
  it('requires key inputs and sends a precise bronze request', () => {
    const create = vi.fn()
    render(<BronzeWizard pipelines={['bronze_load']} busy={false} onCancel={() => {}} onCreate={create} />)
    expect((screen.getByRole('button', { name: 'Create flowgroup' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Flowgroup name/), { target: { value: 'orders_bronze' } })
    fireEvent.change(screen.getByLabelText(/Landing files path/), { target: { value: '${landing_volume}/orders/' } })
    fireEvent.change(screen.getByLabelText(/Bronze table/), { target: { value: 'orders' } })
    expect((screen.getByRole('button', { name: 'Create flowgroup' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Create flowgroup' }))
    expect(create).toHaveBeenCalledWith({ name: 'orders_bronze', pipeline: 'bronze_load', sourcePath: '${landing_volume}/orders/', format: 'csv', target: 'orders' })
  })
})
