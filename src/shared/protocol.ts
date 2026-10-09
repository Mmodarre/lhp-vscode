/** The sole host/webview contract. Paths are project-relative POSIX paths; ranges
 * are zero-based UTF-16 editor coordinates. Only the host resolves file URIs.
 * Native TextDocuments are authoritative; every mutation checks their version. */
export const PROTOCOL_VERSION = 2 as const;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type {
  ProjectResourceIndex,
  ProjectResource,
  ResourceKind,
  ResourceConsumer,
  ProjectDatasetIndex,
  DatasetEntry,
  DatasetSource,
  SubstitutionToken,
  InspectionKind,
  InspectionRequest,
} from './projectModel';
export type YamlPath = (string | number)[];
export interface Position {
  line: number;
  character: number;
}
export interface SourceRange {
  start: Position;
  end: Position;
}
export interface SourceRef {
  path: string;
  /** Zero-based YAML document within a multi-document file, default 0. */
  documentIndex?: number;
  range?: SourceRange;
  yamlPath?: YamlPath;
  label?: string;
}
export interface DocumentState {
  path: string;
  version: number;
  dirty: boolean;
}
/** Source text stays in the extension host; the webview needs only versions. */
export interface DocumentSnapshot extends DocumentState {
  text: string;
}
export interface RuntimeInfo {
  interpreter: string;
  pythonVersion?: string;
  lhpVersion?: string;
  compatible: boolean;
  message?: string;
  capabilities: string[];
}
export interface ProjectSummary {
  id: string;
  name: string;
  rootLabel: string;
}
export interface ProjectContext {
  project: ProjectSummary;
  environment: string;
  environments: string[];
  runtime: RuntimeInfo;
  trusted: boolean;
}
export interface SandboxViewState {
  mode: 'off' | 'on';
  /** Display choice never changes the bridge's generation scope. */
  display: 'selected' | 'all';
  profilePath: '.lhp/profile.yaml';
  profileExists: boolean;
  profileSource: 'saved' | 'draft' | 'missing';
  namespace?: string;
  patterns: string[];
  selectedPipelines: string[];
  totalPipelines: number;
  allowedEnvironments: string[];
  environment: string;
  strategy?: string;
  tablePattern?: string;
  valid: boolean;
  error?: string;
  stale: boolean;
  scopeComplete: boolean;
  previewParity: 'source-only' | 'full' | 'unknown';
  generatedOutputScope?: string;
}
export interface RelatedFile extends SourceRef {
  kind: 'sql' | 'python' | 'schema' | 'expectations' | 'config' | 'template' | 'blueprint';
  exists: boolean;
  editable: boolean;
  /** Authored field that points to this file; target path alone is not provenance. */
  referenceSource?: SourceRef;
  actionName?: string;
  dynamic?: boolean;
}
export interface Origin {
  kind: 'direct' | 'template' | 'blueprint' | 'generated';
  definition?: SourceRef;
  instance?: SourceRef;
  description?: string;
}
export interface ActionNode {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  flowgroupId: string;
  source: SourceRef;
  raw: JsonObject;
  resolved?: JsonObject;
  inputs: string[];
  outputs: string[];
  relatedFiles: RelatedFile[];
  origin: Origin;
  editable: boolean;
  readOnlyReason?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  dataset: string;
  editable: boolean;
  reason?: string;
}
export interface FlowgroupSummary {
  id: string;
  name: string;
  pipeline: string;
  source: SourceRef;
  actionCount: number;
  origin: Origin;
}
export interface PipelineSummary {
  name: string;
  flowgroups: FlowgroupSummary[];
}
export interface FlowgroupDetail extends FlowgroupSummary {
  /** Invocation parameters can be edited even when generated actions cannot. */
  instanceEditable: boolean;
  actions: ActionNode[];
  edges: GraphEdge[];
  raw: JsonObject;
  editable: boolean;
  readOnlyReason?: string;
}
export interface FieldDefinition {
  name: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  choices?: JsonValue[];
  default?: JsonValue;
}
export interface ActionDefinition {
  type: string;
  subtype?: string;
  label: string;
  description: string;
  fields: FieldDefinition[];
  defaults: JsonObject;
  schema?: JsonObject;
}
export interface TemplateDefinition {
  name: string;
  source: SourceRef;
  description?: string;
  fields: FieldDefinition[];
  consumers?: string[];
}
export interface BlueprintDefinition extends TemplateDefinition {}
export interface EditorCatalog {
  actions: ActionDefinition[];
  templates: TemplateDefinition[];
  blueprints: BlueprintDefinition[];
  presets: { name: string; source?: SourceRef; description?: string }[];
  schemas: { kind: string; schema: JsonObject; patterns: string[] }[];
  templateRelatedFiles?: Record<string, RelatedFile[]>;
}
export interface EditorDiagnostic {
  severity: 'error' | 'warning' | 'information';
  message: string;
  code?: string;
  source?: SourceRef;
  layer: 'syntax' | 'configuration' | 'generation';
}
export interface ProjectSnapshot {
  revision: number;
  context: ProjectContext;
  pipelines: PipelineSummary[];
  flowgroups: FlowgroupDetail[];
  /** Cross-flowgroup data dependencies; source/target are FlowgroupSummary.id. */
  flowgroupEdges: GraphEdge[];
  /** Canonical project graph, with pipeline names as source/target identities. */
  pipelineEdges?: GraphEdge[];
  projectMetadata?: JsonObject;
  documents: DocumentState[];
  catalog: EditorCatalog;
  diagnostics: EditorDiagnostic[];
  stale: boolean;
  /** Independent of source validity and runtime compatibility. */
  refreshState?: 'loading' | 'ready' | 'failed';
  refreshError?: string;
  notices: string[];
  sandbox?: SandboxViewState;
  /** Compact full-project known-use summaries; exact references stay in the host index. */
  resourceUsages?: Record<
    string,
    { knownUseCount: number; usageComplete: boolean; knownLabels: string[] }
  >;
}
export interface PreviewFile {
  path: string;
  content: string;
  kind: string;
  pipeline?: string;
}
export interface PreviewResult {
  files: PreviewFile[];
  notices: string[];
  parity: 'source-only' | 'full';
  documentVersions: Record<string, number>;
  scopeIdentity?: string;
  mode?: 'off' | 'on';
  environment?: string;
  namespace?: string;
}
export interface OperationStatus {
  operation:
    | 'snapshot'
    | 'validate'
    | 'preview'
    | 'generate'
    | 'setup'
    | 'create'
    | 'inspect'
    | 'catalog'
    | 'data';
  running: boolean;
  message: string;
  success?: boolean;
}

export type ActionMutation =
  | { kind: 'add'; flowgroupId: string; action: JsonObject }
  | { kind: 'delete'; actionId: string }
  | { kind: 'duplicate'; actionId: string; newName: string }
  | { kind: 'configure'; actionId: string; values: JsonObject }
  | { kind: 'connect'; sourceId: string; targetId: string; dataset: string }
  | { kind: 'disconnect'; sourceId: string; targetId: string; dataset: string }
  | { kind: 'configureFlowgroup'; flowgroupId: string; values: JsonObject }
  | { kind: 'setValue'; source: SourceRef; value: JsonValue };

/** Requests always carry requestId; projectId is checked against the bound panel. */
export interface RequestContext {
  projectId: string;
  revision: number;
}
export type WebviewRequest = WebviewRequestBody & { context?: RequestContext };
type WebviewRequestBody =
  | { type: 'ready'; requestId: string }
  | { type: 'refresh'; requestId: string }
  | { type: 'selectProject'; requestId: string; projectId: string }
  | { type: 'selectEnvironment'; requestId: string; environment: string }
  | { type: 'setSandboxMode'; requestId: string; mode: 'off' | 'on' }
  | { type: 'configureSandboxProfile'; requestId: string }
  | { type: 'setPipelineDisplay'; requestId: string; display: 'selected' | 'all' }
  | { type: 'showSandboxScope'; requestId: string }
  | { type: 'showUsages'; requestId: string; path: string }
  | {
      type: 'mutate';
      requestId: string;
      projectId: string;
      documentVersions: Record<string, number>;
      mutation: ActionMutation;
    }
  | { type: 'openSource'; requestId: string; source: SourceRef }
  | { type: 'validate'; requestId: string }
  | { type: 'preview'; requestId: string }
  | { type: 'generate'; requestId: string }
  | { type: 'selectInterpreter'; requestId: string }
  | { type: 'setupEnvironment'; requestId: string }
  | { type: 'createProject'; requestId: string }
  | { type: 'createBronze'; requestId: string; values: BronzeRequest }
  | {
      type: 'createFlowgroup';
      requestId: string;
      values: { name: string; pipeline: string; targetPath: string };
    }
  | { type: 'createInstance'; requestId: string; values: InstanceRequest }
  | { type: 'cancel'; requestId: string }
  | { type: 'databricks'; requestId: string }
  | { type: 'showPreviewFile'; requestId: string; path: string }
  | { type: 'loadData'; requestId: string }
  | { type: 'showHelp'; requestId: string }
  | { type: 'undo'; requestId: string }
  | { type: 'redo'; requestId: string };

export interface BronzeRequest {
  name: string;
  pipeline: string;
  sourcePath: string;
  format: string;
  target: string;
}
export interface InstanceRequest {
  kind: 'template' | 'blueprint';
  definition: string;
  name: string;
  pipeline: string;
  /** New project-relative YAML file; host rejects existing paths. */
  targetPath: string;
  parameters: JsonObject;
}
/** A one-shot navigation intent bound to the same project and graph revision. */
export interface DesignerSelection {
  projectId: string;
  revision: number;
  pipeline?: string;
  flowgroupId?: string;
  actionId?: string;
  view?: 'project' | 'pipeline' | 'flowgroup' | 'dataset';
  datasetId?: string;
}
export type HostMessage =
  | {
      type: 'bootstrap';
      protocolVersion: typeof PROTOCOL_VERSION;
      projects: ProjectSummary[];
      snapshot?: ProjectSnapshot;
      trusted: boolean;
      selection?: DesignerSelection;
      logoUri?: string;
      datasets?: import('./projectModel').ProjectDatasetIndex;
      sandbox?: SandboxViewState;
    }
  | { type: 'select'; selection: DesignerSelection }
  | { type: 'datasets'; datasets: import('./projectModel').ProjectDatasetIndex }
  | {
      type: 'guide';
      projectId: string;
      revision: number;
      guide: 'bronze' | 'template' | 'blueprint' | 'flowgroup';
      definition?: string;
    }
  | { type: 'snapshot'; snapshot: ProjectSnapshot }
  | { type: 'sandbox'; projectId: string; revision: number; sandbox: SandboxViewState }
  | { type: 'result'; requestId: string; success: boolean; message?: string }
  | { type: 'error'; requestId?: string; code: string; message: string; recoverable: boolean }
  | { type: 'status'; status: OperationStatus }
  | { type: 'preview'; result: PreviewResult }
  | { type: 'diagnostics'; diagnostics: EditorDiagnostic[] };

export const WEBVIEW_REQUEST_TYPES = [
  'ready',
  'refresh',
  'selectProject',
  'selectEnvironment',
  'setSandboxMode',
  'configureSandboxProfile',
  'setPipelineDisplay',
  'showSandboxScope',
  'showUsages',
  'mutate',
  'openSource',
  'validate',
  'preview',
  'generate',
  'selectInterpreter',
  'setupEnvironment',
  'createProject',
  'createBronze',
  'createFlowgroup',
  'createInstance',
  'cancel',
  'databricks',
  'showPreviewFile',
  'loadData',
  'showHelp',
  'undo',
  'redo',
] as const;

/** Python transport is NDJSON. Only one request is in flight per process;
 * stdout contains envelopes only, stderr is bounded diagnostic logging. */
export type BridgeOperation =
  | 'health'
  | 'snapshot'
  | 'catalog'
  | 'validate'
  | 'preview'
  | 'generate'
  | 'init'
  | 'scaffold'
  | 'inspect'
  | 'data';
export interface DocumentOverlay {
  path: string;
  text: string;
  version: number;
}
export interface BridgeRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  operation: BridgeOperation;
  projectRoot?: string;
  environment?: string;
  documents?: DocumentOverlay[];
  options?: JsonObject;
}
export type BridgeEnvelope =
  | { protocolVersion: typeof PROTOCOL_VERSION; id: string; type: 'result'; result: JsonValue }
  | { protocolVersion: typeof PROTOCOL_VERSION; id: string; type: 'event'; event: JsonObject }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      id: string;
      type: 'error';
      code: string;
      message: string;
      details?: JsonValue;
    };
