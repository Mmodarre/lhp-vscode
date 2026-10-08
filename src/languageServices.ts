import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { relativePath } from './paths';
import { isRecord } from './shared/guards';
import type { ProjectSnapshot, SourceRef } from './shared/protocol';

interface SchemaApi {
  registerContributor(
    scheme: string,
    request: (resource: string) => string,
    content: (uri: string) => Promise<string> | string,
  ): boolean;
}
export class LanguageServices implements vscode.Disposable {
  private readonly projects = new Map<
    string,
    { root: string; snapshot: ProjectSnapshot; base: vscode.Uri }
  >();
  private readonly schemas = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  async register(): Promise<void> {
    const extension = vscode.extensions.getExtension<unknown>('redhat.vscode-yaml');
    if (!extension)
      throw new Error(
        'Red Hat YAML is required. Install redhat.vscode-yaml to enable LHP schemas.',
      );
    const api: unknown = extension.isActive ? extension.exports : await extension.activate();
    if (!isRecord(api) || typeof api.registerContributor !== 'function')
      throw new Error('The installed YAML extension does not expose its schema contribution API.');
    const registered = (api as unknown as SchemaApi).registerContributor(
      'lhp-schema',
      (uri) => this.schemaFor(uri),
      (uri) => this.schemas.get(uri) ?? '{}',
    );
    if (!registered)
      throw new Error('LHP schema contributor could not be registered. Reload the VS Code window.');
    const selector: vscode.DocumentSelector = { language: 'yaml', scheme: 'file' };
    this.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        selector,
        {
          provideCompletionItems: (document, position) => {
            const project = this.forDocument(document);
            if (!project) return [];
            const line = document.lineAt(position).text.slice(0, position.character);
            const values = /template\s*:/.test(line)
              ? project.snapshot.catalog.templates.map((t) => ({
                  name: t.name,
                  detail: t.description,
                }))
              : /blueprint\s*:/.test(line)
                ? project.snapshot.catalog.blueprints.map((t) => ({
                    name: t.name,
                    detail: t.description,
                  }))
                : /presets?\s*:/.test(line)
                  ? project.snapshot.catalog.presets.map((t) => ({
                      name: t.name,
                      detail: t.description,
                    }))
                  : /(?:source|depends_on)\s*:/.test(line)
                    ? project.snapshot.flowgroups.flatMap((f) =>
                        f.actions.flatMap((a) =>
                          a.outputs.map((name) => ({
                            name,
                            detail: `${f.pipeline} / ${f.name} / ${a.name}`,
                          })),
                        ),
                      )
                    : [];
            return values.map((value) => {
              const item = new vscode.CompletionItem(
                value.name,
                vscode.CompletionItemKind.Reference,
              );
              item.detail = value.detail;
              return item;
            });
          },
        },
        ':',
        ' ',
        '$',
      ),
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (document, position) => {
          const project = this.forDocument(document);
          if (!project) return undefined;
          const range = document.getWordRangeAtPosition(position, /[\w.$/{}-]+/);
          if (!range) return undefined;
          const value = document.getText(range);
          const sources: SourceRef[] = project.snapshot.flowgroups.flatMap((f) =>
            f.actions.filter((a) => a.outputs.includes(value)).map((a) => a.source),
          );
          for (const item of [
            ...project.snapshot.catalog.templates,
            ...project.snapshot.catalog.blueprints,
            ...project.snapshot.catalog.presets,
          ])
            if (item.name === value && item.source) sources.push(item.source);
          return sources.map(
            (source) =>
              new vscode.Location(
                vscode.Uri.joinPath(vscode.Uri.file(project.root), source.path),
                new vscode.Position(
                  source.range?.start.line ?? 0,
                  source.range?.start.character ?? 0,
                ),
              ),
          );
        },
      }),
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position) => {
          const project = this.forDocument(document);
          if (!project) return undefined;
          const file = relativePath(project.root, document.uri.fsPath);
          const action = project.snapshot.flowgroups
            .flatMap((f) => f.actions)
            .find(
              (a) =>
                a.source.path === file &&
                a.source.range &&
                position.line >= a.source.range.start.line &&
                position.line <= a.source.range.end.line,
            );
          if (!action) return undefined;
          const field = document.lineAt(position).text.match(/^\s*([\w_]+)\s*:/)?.[1];
          const definition = project.snapshot.catalog.actions.find(
            (d) => d.type === action.type && d.subtype === action.subtype,
          );
          const help = definition?.fields.find(
            (f) => f.name === field || f.name.endsWith('.' + field),
          );
          if (!help?.description) return undefined;
          const markdown = new vscode.MarkdownString();
          markdown.appendText(help.description);
          return new vscode.Hover(markdown);
        },
      }),
    );
  }
  update(root: string, snapshot: ProjectSnapshot): void {
    const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(snapshot.catalog.schemas))
      .digest('hex')
      .slice(0, 12);
    const previous = this.projects.get(root);
    const base = vscode.Uri.from({ scheme: 'lhp-schema', path: `/${key}/${fingerprint}/` });
    if (previous && previous.base.toString() !== base.toString())
      for (const uri of this.schemas.keys())
        if (uri.startsWith(previous.base.toString())) this.schemas.delete(uri);
    this.projects.set(root, { root, snapshot, base });
    for (const item of snapshot.catalog.schemas) {
      const name = item.kind.endsWith('.json') ? item.kind : `${item.kind}.schema.json`;
      const uri = vscode.Uri.joinPath(base, name);
      this.schemas.set(uri.toString(), JSON.stringify({ ...item.schema, $id: uri.toString() }));
    }
    const union = vscode.Uri.joinPath(base, 'authoring.schema.json');
    this.schemas.set(
      union.toString(),
      JSON.stringify({
        $id: union.toString(),
        anyOf: ['flowgroup', 'instance'].map((kind) => ({ $ref: `${kind}.schema.json` })),
      }),
    );
  }
  prune(roots: string[]): void {
    for (const [root, project] of this.projects)
      if (!roots.includes(root)) {
        this.projects.delete(root);
        for (const uri of this.schemas.keys())
          if (uri.startsWith(project.base.toString())) this.schemas.delete(uri);
      }
  }
  private forDocument(document: vscode.TextDocument) {
    return [...this.projects.values()]
      .filter((p) => relativePath(p.root, document.uri.fsPath))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }
  schemaFor(resource: string): string {
    const uri = vscode.Uri.parse(resource);
    if (uri.scheme !== 'file') return '';
    for (const project of [...this.projects.values()].sort(
      (a, b) => b.root.length - a.root.length,
    )) {
      const relative = relativePath(project.root, uri.fsPath);
      if (!relative) continue;
      const kind =
        relative === 'lhp.yaml'
          ? 'project'
          : /^blueprints\//.test(relative)
            ? 'blueprint'
            : /^templates\//.test(relative)
              ? 'template'
              : /^presets\//.test(relative)
                ? 'preset'
                : /^substitutions\//.test(relative)
                  ? 'substitution'
                  : relative === 'config/pipeline_config.yaml'
                    ? 'pipeline_config'
                    : relative === 'config/job_config.yaml'
                      ? 'job_config'
                      : /^schemas\/.*\.ya?ml$/.test(relative)
                        ? 'schema'
                        : project.snapshot.flowgroups.some((f) => f.source.path === relative) ||
                            /^pipelines\//.test(relative)
                          ? 'authoring'
                          : undefined;
      if (!kind) return '';
      const candidate = vscode.Uri.joinPath(project.base, `${kind}.schema.json`).toString();
      return this.schemas.has(candidate) ? candidate : '';
    }
    return '';
  }
  dispose(): void {
    this.projects.clear();
    this.schemas.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
