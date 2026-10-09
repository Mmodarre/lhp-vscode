import type { ProjectDatasetIndex, ProjectResourceIndex } from './shared/projectModel';
import type {
  ItemIntent,
  ItemKind,
  ItemRef,
  ViewItem,
  ViewName,
  ViewState,
} from './sidebarViewsModel';

type Fields = Omit<ViewItem, keyof ItemRef | 'view' | 'kind' | 'intent'> & { intent?: ItemIntent };
type Add = (view: ViewName, kind: ItemKind, key: string, fields: Fields) => ViewItem;

const CATEGORIES = [
  ['template', 'Templates'],
  ['blueprint', 'Blueprints'],
  ['preset', 'Presets'],
  ['schema', 'Schemas & transforms'],
  ['expectations', 'Expectations'],
  ['sql', 'SQL'],
  ['python', 'Python'],
  ['pipeline', 'Authoring YAML'],
  ['configuration', 'Configuration files'],
  ['other', 'Other files'],
] as const;

export function resourceRoots(index: ProjectResourceIndex | undefined, add: Add): ViewItem[] {
  return CATEGORIES.map(([kind, label]) => {
    const count = index?.files.filter((file) => file.kind === kind).length ?? 0;
    return add('resources', 'category', kind, {
      label,
      group: kind,
      description: !index
        ? 'Index not loaded'
        : index.loading
          ? 'Indexing…'
          : index.complete
            ? String(count)
            : `${count}+ · incomplete`,
      expandable: count > 0,
    });
  });
}

export function dataRoots(
  state: ViewState,
  data: ProjectDatasetIndex | undefined,
  add: Add,
): ViewItem[] {
  if (data)
    return [
      add('data', 'category', 'declared', {
        label: 'Declared tables & sinks',
        group: 'declared',
        description: String(data.datasets.filter((entry) => entry.kind !== 'external').length),
        expandable: true,
      }),
      add('data', 'category', 'external', {
        label: 'External & unresolved',
        group: 'external',
        description: String(data.datasets.filter((entry) => entry.kind === 'external').length),
        expandable: true,
      }),
    ];
  return [
    add('data', 'notice', 'load', {
      label: !state.trusted
        ? 'Trust workspace to load declared lineage'
        : state.runtime && !state.runtime.compatible
          ? 'Select compatible Python for lineage'
          : 'Load declared lineage',
      description: 'Local project model; no warehouse query',
      expandable: false,
      intent: !state.trusted
        ? 'none'
        : state.runtime && !state.runtime.compatible
          ? 'interpreter'
          : 'loadData',
    }),
  ];
}

export function generatedRoots(index: ProjectResourceIndex | undefined, add: Add): ViewItem[] {
  const files = index?.files.filter((file) => file.kind === 'generated') ?? [];
  const environments = [...new Set(files.map((file) => file.environment ?? 'other'))].sort();
  const rows = environments.map((environment) =>
    add('generated', 'category', environment, {
      label: environment,
      group: environment,
      description: `${files.filter((file) => (file.environment ?? 'other') === environment).length} persisted files`,
      expandable: true,
    }),
  );
  return rows.length
    ? rows
    : [
        add('generated', 'notice', 'empty', {
          label: index?.loading
            ? 'Finding persisted output…'
            : !index
              ? 'File index not loaded.'
              : index.complete
                ? 'No persisted generated output found.'
                : 'No generated files indexed; inventory is incomplete.',
          expandable: false,
        }),
      ];
}
