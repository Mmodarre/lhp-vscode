import { describe, expect, it } from 'vitest'
import { actionGraph, documentVersions, fieldValue, layoutGraph, pipelineGraph, setFieldValue } from './model'
import { demoSnapshot } from './demoFixture'

describe('webview graph models', () => {
  it('uses authoritative cross-flowgroup edges for pipeline graph', () => {
    const snapshot = demoSnapshot()
    const graph = pipelineGraph(snapshot, 'bronze_load')
    expect(graph.items.map((item) => item.id)).toEqual(['orders', 'customers', 'inventory'])
    expect(graph.edges.map((edge) => [edge.source, edge.target, edge.dataset])).toEqual([
      ['orders', 'customers', 'customer_reference'],
      ['customers', 'inventory', 'inventory_lookup'],
    ])
    expect(pipelineGraph(snapshot, 'silver_curate').edges).toEqual([])
  })

  it('uses actual action dependencies, not sequence-adjacent invented edges', () => {
    const detail = demoSnapshot().flowgroups[0]!
    const graph = actionGraph(detail)
    expect(graph.edges.map((edge) => edge.dataset)).toEqual(['v_orders_raw', 'v_orders_clean'])
    expect(graph.items[0]?.readonly).toBe(false)
    expect(actionGraph(demoSnapshot().flowgroups[2]!).items[0]?.readonly).toBe(true)
  })

  it('positions a DAG in dependency layers and retains cyclic nodes', () => {
    const graph = actionGraph(demoSnapshot().flowgroups[0]!)
    const positions = layoutGraph(graph.items, graph.edges)
    expect(positions['orders:load']!.x).toBeLessThan(positions['orders:cleanse']!.x)
    expect(positions['orders:cleanse']!.x).toBeLessThan(positions['orders:write']!.x)
    const cyclic = layoutGraph(graph.items.slice(0, 2), [
      { id: 'a', source: 'orders:load', target: 'orders:cleanse', dataset: 'a', editable: true },
      { id: 'b', source: 'orders:cleanse', target: 'orders:load', dataset: 'b', editable: true },
    ])
    expect(Object.keys(cyclic)).toHaveLength(2)
  })

  it('updates nested fields without dropping unknown action keys', () => {
    const source = { name: 'load', source: { type: 'cloudfiles', path: '/old', options: { custom: true } }, custom: 7 }
    const next = setFieldValue(source, 'source.path', '/new')
    expect(fieldValue(next, 'source.path')).toBe('/new')
    expect(fieldValue(next, 'source.options.custom')).toBe(true)
    expect(source.source.path).toBe('/old')
    expect(next.custom).toBe(7)
  })

  it('includes native document versions in every edit request', () => {
    expect(documentVersions(demoSnapshot())).toMatchObject({ 'pipelines/bronze/orders_bronze.yaml': 4 })
  })
})
