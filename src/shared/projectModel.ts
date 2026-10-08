import type { EditorCatalog, GraphEdge, JsonObject, SourceRef } from './protocol';

/** A physical inventory is available even before Python or semantic inspection. */
export type ResourceKind =
  | 'template'
  | 'blueprint'
  | 'preset'
  | 'schema'
  | 'expectations'
  | 'sql'
  | 'python'
  | 'configuration'
  | 'pipeline'
  | 'other'
  | 'generated';
export interface ResourceConsumer {
  label: string;
  source: SourceRef;
  pipeline?: string;
  flowgroupId?: string;
  actionId?: string;
}
export interface ProjectResource {
  /** Stable opaque identity; command handlers resolve this against current state. */
  id: string;
  kind: ResourceKind;
  path: string;
  name: string;
  source: SourceRef;
  exists: boolean;
  /** Known from catalogue/declarations; physical presence alone does not imply use. */
  registered: boolean;
  consumers: ResourceConsumer[];
  /** Verified from a successful generation response, not inferred from filenames. */
  authoringSources?: ResourceConsumer[];
  configurationKind?:
    | 'project'
    | 'pipeline'
    | 'job'
    | 'monitoring'
    | 'environment'
    | 'bundle'
    | 'bundle-template'
    | 'other';
  environment?: string;
  generatedKind?: 'source' | 'wheel' | 'bundle' | 'monitoring' | 'other';
}
export interface SubstitutionToken {
  name: string;
  source: SourceRef;
  environment: string;
  /** Secret references are names only; no credential lookup is performed. */
  secretReference?: boolean;
}
export interface ProjectResourceIndex {
  projectId: string;
  revision: number;
  files: ProjectResource[];
  environments: string[];
  tokens: SubstitutionToken[];
  complete: boolean;
  loading: boolean;
  warnings: string[];
}
export interface DatasetSource {
  label: string;
  source?: SourceRef;
  pipeline?: string;
  flowgroupId?: string;
  actionId?: string;
}
export interface DatasetEntry {
  id: string;
  name: string;
  kind: 'table' | 'sink' | 'external';
  producers: DatasetSource[];
  consumers: DatasetSource[];
  upstream: string[];
  downstream: string[];
}
export interface ProjectDatasetIndex {
  projectId: string;
  revision: number;
  environment: string;
  datasets: DatasetEntry[];
  edges: GraphEdge[];
  warnings: string[];
  stale: boolean;
}
export type InspectionKind =
  | 'template'
  | 'pipelineConfig'
  | 'jobConfig'
  | 'preset'
  | 'substitutions';
export interface InspectionRequest {
  kind: InspectionKind;
  resourceId: string;
  stage?: 'inspect' | 'expanded' | 'resolved';
}
export interface CatalogueBootstrap {
  catalog: EditorCatalog;
  project?: JsonObject;
}
