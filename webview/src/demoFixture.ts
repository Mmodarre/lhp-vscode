/** Development-only snapshots for visual and interaction checks. Never imported by the shipped entry. */
import type { ActionNode, ProjectSnapshot, SourceRef } from '../../src/shared/protocol'

const actionSource = (path: string, line: number): SourceRef => ({ path, range: { start: { line, character: 2 }, end: { line: line + 1, character: 0 } } })
const ordersPath = 'pipelines/bronze/orders_bronze.yaml'
const customerPath = 'pipelines/bronze/customers_bronze.yaml'
const templatePath = 'templates/standard_ingestion.yaml'
const instancePath = 'pipelines/bronze/inventory_ingestion.yaml'

function action(value: Partial<ActionNode> & Pick<ActionNode, 'id' | 'name' | 'type' | 'source' | 'raw'>): ActionNode {
  return {
    flowgroupId: 'orders', inputs: [], outputs: [], relatedFiles: [], origin: { kind: 'direct' }, editable: true,
    ...value,
  }
}

export function demoSnapshot(variant: 'normal' | 'stale' | 'runtime' = 'normal'): ProjectSnapshot {
  const load = action({ id: 'orders:load', flowgroupId: 'orders', name: 'load_orders', type: 'load', subtype: 'cloudfiles',
    source: actionSource(ordersPath, 7), raw: { name: 'load_orders', type: 'load', source: { type: 'cloudfiles', path: '${landing_volume}/orders/', format: 'csv', schema_file: 'schemas/orders.yaml' }, target: 'v_orders_raw' },
    outputs: ['v_orders_raw'], relatedFiles: [{ path: 'schemas/orders.yaml', kind: 'schema', exists: true, editable: true }] })
  const cleanse = action({ id: 'orders:cleanse', flowgroupId: 'orders', name: 'cleanse_orders', type: 'transform', subtype: 'sql',
    source: actionSource(ordersPath, 18), raw: { name: 'cleanse_orders', type: 'transform', transform_type: 'sql', source: 'v_orders_raw', sql_path: 'sql/cleanse_orders.sql', target: 'v_orders_clean' },
    inputs: ['v_orders_raw'], outputs: ['v_orders_clean'], relatedFiles: [{ path: 'sql/cleanse_orders.sql', kind: 'sql', exists: true, editable: true }] })
  const write = action({ id: 'orders:write', flowgroupId: 'orders', name: 'write_orders_bronze', type: 'write', subtype: 'streaming_table',
    source: actionSource(ordersPath, 26), raw: { name: 'write_orders_bronze', type: 'write', source: 'v_orders_clean', write_target: { type: 'streaming_table', catalog: '${catalog}', schema: '${bronze_schema}', table: 'orders' } },
    inputs: ['v_orders_clean'], outputs: ['${catalog}.${bronze_schema}.orders'] })
  const customerLoad = action({ id: 'customers:load', flowgroupId: 'customers', name: 'load_customers', type: 'load', subtype: 'cloudfiles',
    source: actionSource(customerPath, 6), raw: { name: 'load_customers', type: 'load', source: { type: 'cloudfiles', path: '${landing_volume}/customers/', format: 'json' }, target: 'v_customers' },
    outputs: ['v_customers'] })
  const inherited = action({ id: 'inventory:load', flowgroupId: 'inventory', name: 'load_inventory', type: 'load', subtype: 'cloudfiles',
    source: actionSource(templatePath, 13), raw: { name: 'load_inventory', type: 'load', source: { type: 'cloudfiles', path: '${landing_volume}/inventory/', format: 'csv' } },
    outputs: ['v_inventory'], origin: { kind: 'template', definition: { path: templatePath }, instance: { path: instancePath }, description: 'Expanded from a reusable CSV ingestion template.' },
    editable: false, readOnlyReason: 'Edit the template definition or instance parameters; expanded actions are read only.' })
  const orders = { id: 'orders', name: 'orders_bronze', pipeline: 'bronze_load', source: { path: ordersPath }, actionCount: 3, origin: { kind: 'direct' as const },
    actions: [load, cleanse, write], raw: { pipeline: 'bronze_load', flowgroup: 'orders_bronze' }, editable: true, instanceEditable: true,
    edges: [
      { id: 'orders:e1', source: load.id, target: cleanse.id, dataset: 'v_orders_raw', editable: true },
      { id: 'orders:e2', source: cleanse.id, target: write.id, dataset: 'v_orders_clean', editable: true },
    ] }
  const customers = { id: 'customers', name: 'customers_bronze', pipeline: 'bronze_load', source: { path: customerPath }, actionCount: 1, origin: { kind: 'direct' as const },
    actions: [customerLoad], raw: { pipeline: 'bronze_load', flowgroup: 'customers_bronze' }, editable: true, instanceEditable: true, edges: [] }
  const inventory = { id: 'inventory', name: 'inventory_ingestion', pipeline: 'bronze_load', source: { path: instancePath }, actionCount: 1,
    origin: { kind: 'template' as const, definition: { path: templatePath }, instance: { path: instancePath } },
    actions: [inherited], raw: { pipeline: 'bronze_load', flowgroup: 'inventory_ingestion', use_template: 'csv_ingestion', template_parameters: { landing_folder: 'inventory' } },
    editable: false, instanceEditable: true, edges: [] }
  return {
    revision: 7,
    context: { project: { id: 'demo', name: 'Demo Lakehouse', rootLabel: 'demo-lhp/' }, environment: 'dev', environments: ['dev', 'test', 'prod'],
      runtime: { interpreter: '/demo/python', lhpVersion: variant === 'runtime' ? undefined : '0.9.3', compatible: variant !== 'runtime',
        message: variant === 'runtime' ? 'Compatible LHP 0.9.3 integration build not found.' : undefined, capabilities: ['snapshot', 'validate', 'preview', 'generate'] }, trusted: true },
    pipelines: [{ name: 'bronze_load', flowgroups: [orders, customers, inventory] }, { name: 'silver_curate', flowgroups: [] }],
    flowgroups: [orders, customers, inventory],
    flowgroupEdges: [
      { id: 'fg:orders-customers', source: 'orders', target: 'customers', dataset: 'customer_reference', editable: false, reason: 'Derived data dependency' },
      { id: 'fg:customers-inventory', source: 'customers', target: 'inventory', dataset: 'inventory_lookup', editable: false, reason: 'Derived data dependency' },
    ],
    documents: [
      { path: ordersPath, version: 4, dirty: variant === 'stale', text: variant === 'stale' ? 'pipeline: bronze_load\nactions: [\n' : 'pipeline: bronze_load\nflowgroup: orders_bronze\n' },
      { path: customerPath, version: 1, dirty: false, text: 'pipeline: bronze_load\nflowgroup: customers_bronze\n' },
      { path: instancePath, version: 1, dirty: false, text: 'use_template: csv_ingestion\n' },
    ],
    catalog: {
      actions: [
        { type: 'load', subtype: 'cloudfiles', label: 'Auto Loader (files)', description: 'Read incoming files from a cloud or volume path.', defaults: { type: 'load', source: { type: 'cloudfiles' } },
          fields: [{ name: 'source.path', label: 'Landing path', type: 'string', required: true }, { name: 'source.format', label: 'Format', type: 'string', required: true, choices: ['csv', 'json', 'parquet'] }, { name: 'source.schema_file', label: 'Schema file', type: 'string', required: false }, { name: 'target', label: 'Output view', type: 'string', required: true }] },
        { type: 'transform', subtype: 'sql', label: 'SQL transform', description: 'Transform an input view with SQL.', defaults: { type: 'transform', transform_type: 'sql' },
          fields: [{ name: 'source', label: 'Input view', type: 'string', required: true }, { name: 'sql_path', label: 'SQL source file', type: 'string', required: false }, { name: 'target', label: 'Output view', type: 'string', required: true }] },
        { type: 'write', subtype: 'streaming_table', label: 'Streaming table', description: 'Write a view to a managed streaming table.', defaults: { type: 'write', write_target: { type: 'streaming_table' } },
          fields: [{ name: 'source', label: 'Input view', type: 'string', required: true }, { name: 'write_target.catalog', label: 'Catalog', type: 'string', required: true }, { name: 'write_target.schema', label: 'Schema', type: 'string', required: true }, { name: 'write_target.table', label: 'Table', type: 'string', required: true }] },
      ],
      templates: [{ name: 'csv_ingestion', source: { path: templatePath }, description: 'Reusable CSV ingestion.', fields: [{ name: 'landing_folder', label: 'Landing folder', type: 'string', required: true }] }],
      blueprints: [{ name: 'system_bronze', source: { path: 'blueprints/system_bronze.yaml' }, description: 'Bronze ingestion for one source system.', fields: [{ name: 'source_path', label: 'Source path', type: 'string', required: true }] }],
      presets: [], schemas: [],
    },
    diagnostics: variant === 'stale' ? [{ severity: 'error', message: 'Unexpected end of sequence', code: 'YAML-SYNTAX', source: { path: ordersPath, range: { start: { line: 1, character: 9 }, end: { line: 1, character: 10 } } }, layer: 'syntax' }] : [],
    stale: variant === 'stale', notices: [],
  }
}
