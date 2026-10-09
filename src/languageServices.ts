import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { containedPath, relativePath } from './paths';
import { isRecord } from './shared/guards';
import type { EditorCatalog, ProjectSnapshot, SourceRef } from './shared/protocol';
import type { ProjectResourceIndex } from './shared/projectModel';
import { analyzeYaml, type YamlCursorContext } from './languageContext';
import { classifyLhpYaml, type LhpSchemaKind } from './languageClassification';
import { PROFILE_SCHEMA } from './profileSchema';
import { parameterContext } from './languageParameters';
import { referenceReplacement, tokenReplacement } from './languageInsert';
import {
  actionSnippets,
  referenceSuggestions,
  snippetForLine,
  substitutionSuggestions,
  type Suggestion,
} from './languageSuggestions';

interface SchemaApi {
  registerContributor(
    scheme: string,
    request: (resource: string) => string,
    content: (uri: string) => Promise<string> | string,
  ): boolean;
}
interface ProjectCache {
  root: string;
  base: vscode.Uri;
  snapshot?: ProjectSnapshot;
  catalog?: EditorCatalog;
  inventory?: ProjectResourceIndex;
  environment?: string;
}
interface QuickFixRequest {
  uri: string;
  version: number;
  start: number;
  end: number;
  before: string;
  replacement: string;
}
/** Custom cursor parsing is bounded; the YAML extension still handles larger files. */
export const MAX_ASSISTED_YAML_BYTES = 2 * 1024 * 1024;

/** Native YAML assistance only. The Red Hat YAML extension still owns schema validation. */
export class LanguageServices implements vscode.Disposable {
  private readonly projects = new Map<string, ProjectCache>();
  private readonly schemas = new Map<string, string>();
  private readonly parses = new Map<
    string,
    { version: number; at: (offset: number) => YamlCursorContext }
  >();
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
    if (
      !(api as unknown as SchemaApi).registerContributor(
        'lhp-schema',
        (resource) => this.schemaFor(resource),
        (uri) => this.schemas.get(uri) ?? '{}',
      )
    )
      throw new Error('LHP schema contributor could not be registered. Reload the VS Code window.');
    const selector: vscode.DocumentSelector = { language: 'yaml', scheme: 'file' };
    this.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        selector,
        {
          provideCompletionItems: (document, position) => this.completions(document, position),
        },
        ':',
        ' ',
        '$',
        '/',
        '.',
      ),
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (document, position) => this.definitions(document, position),
      }),
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position) => this.hover(document, position),
      }),
      vscode.languages.registerCodeActionsProvider(
        selector,
        {
          provideCodeActions: (document, range) => this.quickFixes(document, range),
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
      vscode.commands.registerCommand('lhp.language.applyQuickFix', (request: QuickFixRequest) =>
        this.applyQuickFix(request),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        this.parses.delete(document.uri.toString()),
      ),
    );
  }
  /** Called from project discovery; source classification need not await Python. */
  setProjectRoots(roots: string[]): void {
    const keep = new Set(roots);
    for (const root of this.projects.keys()) if (!keep.has(root)) this.drop(root);
    for (const root of roots) this.ensure(root);
  }
  update(root: string, snapshot: ProjectSnapshot): void {
    const project = this.ensure(root);
    project.snapshot = snapshot;
    project.catalog = snapshot.catalog;
    project.environment = snapshot.context.environment;
    this.updateSchemas(project);
  }
  updateCatalog(root: string, catalog: EditorCatalog): void {
    const project = this.ensure(root);
    project.catalog = catalog;
    this.updateSchemas(project);
  }
  clearCatalog(root: string): void {
    const project = this.projects.get(root);
    if (!project) return;
    project.catalog = undefined;
    for (const uri of this.schemas.keys())
      if (uri.startsWith(project.base.toString())) this.schemas.delete(uri);
    this.registerProfileSchema(project);
  }
  updateInventory(root: string, index: ProjectResourceIndex): void {
    this.ensure(root).inventory = index;
  }
  updateEnvironment(root: string, environment: string): void {
    this.ensure(root).environment = environment;
  }
  prune(roots: string[]): void {
    this.setProjectRoots(roots);
  }
  private ensure(root: string): ProjectCache {
    const existing = this.projects.get(root);
    if (existing) return existing;
    const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
    const project = {
      root,
      base: vscode.Uri.from({ scheme: 'lhp-schema', path: `/${key}/empty/` }),
    };
    this.projects.set(root, project);
    this.registerProfileSchema(project);
    return project;
  }
  private registerProfileSchema(project: ProjectCache): void {
    const uri = vscode.Uri.joinPath(project.base, 'profile.schema.json');
    this.schemas.set(uri.toString(), JSON.stringify({ ...PROFILE_SCHEMA, $id: uri.toString() }));
  }
  private drop(root: string): void {
    const previous = this.projects.get(root);
    if (!previous) return;
    this.projects.delete(root);
    for (const uri of this.schemas.keys())
      if (uri.startsWith(previous.base.toString())) this.schemas.delete(uri);
  }
  private updateSchemas(project: ProjectCache): void {
    const catalog = project.catalog;
    if (!catalog) return;
    const key = createHash('sha256').update(project.root).digest('hex').slice(0, 16);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(catalog.schemas))
      .digest('hex')
      .slice(0, 12);
    const base = vscode.Uri.from({ scheme: 'lhp-schema', path: `/${key}/${fingerprint}/` });
    if (base.toString() !== project.base.toString()) {
      for (const uri of this.schemas.keys())
        if (uri.startsWith(project.base.toString())) this.schemas.delete(uri);
      project.base = base;
    }
    this.registerProfileSchema(project);
    for (const item of catalog.schemas) {
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
  private forUri(
    uri: vscode.Uri,
  ): { project: ProjectCache; relative: string; schema?: LhpSchemaKind } | undefined {
    if (uri.scheme !== 'file') return undefined;
    for (const project of [...this.projects.values()].sort(
      (a, b) => b.root.length - a.root.length,
    )) {
      const relative = relativePath(project.root, uri.fsPath);
      if (!relative) continue;
      const schema = classifyLhpYaml(
        relative,
        project.catalog,
        project.inventory,
        project.snapshot,
      );
      return { project, relative, schema };
    }
    return undefined;
  }
  schemaFor(resource: string): string {
    const match = this.forUri(vscode.Uri.parse(resource));
    if (!match?.schema) return '';
    const candidate = vscode.Uri.joinPath(
      match.project.base,
      `${match.schema}.schema.json`,
    ).toString();
    return this.schemas.has(candidate) ? candidate : '';
  }
  private cursor(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): YamlCursorContext | undefined {
    const uri = document.uri.toString();
    const source = document.getText();
    if (Buffer.byteLength(source, 'utf8') > MAX_ASSISTED_YAML_BYTES) {
      this.parses.delete(uri);
      return undefined;
    }
    let cached = this.parses.get(uri);
    if (!cached || cached.version !== document.version) {
      try {
        cached = { version: document.version, at: analyzeYaml(source) };
      } catch {
        this.parses.delete(uri);
        return undefined;
      }
      this.parses.set(uri, cached);
    }
    try {
      return cached.at(document.offsetAt(position));
    } catch {
      return undefined;
    }
  }
  private completions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const match = this.forUri(document.uri);
    if (!match?.schema) return [];
    const context = this.cursor(document, position);
    if (!context || context.suppressed) return [];
    const before = document.lineAt(position).text.slice(0, position.character);
    const source = document.getText();
    const tokenRange = /\$\{[^}]*$/.test(before)
      ? tokenReplacement(source, context, document.offsetAt(position))
      : undefined;
    const parameter = parameterContext(document.getText(), context, match.project.catalog);
    if (parameter?.atKey)
      return parameter.fields.map((field) => {
        const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Property);
        item.detail = `${parameter.kind} parameter${field.required ? ' · required' : ''}`;
        item.documentation = field.description;
        return item;
      });
    let values: Suggestion[] = [
      ...referenceSuggestions(
        match.schema,
        context,
        match.project.catalog,
        match.project.inventory,
        match.project.snapshot,
      ),
      ...actionSnippets(match.schema, context, match.project.catalog),
    ];
    if (tokenRange)
      values = substitutionSuggestions(
        match.schema,
        context,
        match.project.inventory,
        match.project.environment,
      );
    const valueRange = referenceReplacement(source, context);
    return values.map((value) => {
      const item = new vscode.CompletionItem(
        value.label,
        value.kind === 'snippet'
          ? vscode.CompletionItemKind.Snippet
          : value.kind === 'file'
            ? vscode.CompletionItemKind.File
            : vscode.CompletionItemKind.Reference,
      );
      item.detail = value.detail;
      if (value.insertText)
        item.insertText = new vscode.SnippetString(snippetForLine(value.insertText, before));
      else {
        const range = tokenRange ?? valueRange;
        if (range)
          item.range = new vscode.Range(
            document.positionAt(range.start),
            document.positionAt(range.end),
          );
      }
      return item;
    });
  }
  private sources(
    match: NonNullable<ReturnType<LanguageServices['forUri']>>,
    context: YamlCursorContext,
    offset: number,
    rawValue: string,
  ): SourceRef[] {
    const value = context.value?.trim();
    if (!value || context.suppressed || context.role !== 'value') return [];
    const tokenStart = context.valueRange?.[0];
    if (tokenStart !== undefined) {
      for (const found of rawValue.matchAll(/\$\{([^}]+)\}/g)) {
        const start = tokenStart + (found.index ?? 0);
        if (start <= offset && offset <= start + found[0].length) {
          const token = match.project.inventory?.tokens.find(
            (item) => item.environment === match.project.environment && item.name === found[1],
          );
          return token ? [token.source] : [];
        }
      }
    }
    const key = typeof context.path.at(-1) === 'string' ? context.path.at(-1) : context.path.at(-2);
    const catalog = match.project.catalog;
    if (key === 'use_template')
      return (
        catalog?.templates.filter((item) => item.name === value).map((item) => item.source) ?? []
      );
    if (key === 'use_blueprint')
      return (
        catalog?.blueprints.filter((item) => item.name === value).map((item) => item.source) ?? []
      );
    if (key === 'preset' || key === 'presets')
      return (
        catalog?.presets
          .filter((item) => item.name === value)
          .flatMap((item) => (item.source ? [item.source] : [])) ?? []
      );
    if (key === 'source' || key === 'depends_on')
      return (
        match.project.snapshot?.flowgroups.flatMap((group) =>
          group.actions
            .filter((action) => action.outputs.includes(value))
            .map((action) => action.source),
        ) ?? []
      );
    const file = match.project.inventory?.files.find((item) => item.path === value);
    if (file && key && /(?:path|file)$/.test(String(key))) return [file.source];
    return [];
  }
  private async definitions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const match = this.forUri(document.uri);
    if (!match?.schema) return [];
    const context = this.cursor(document, position);
    if (!context) return [];
    const parameter = parameterContext(document.getText(), context, match.project.catalog);
    const rawValue = context.valueRange
      ? document.getText(
          new vscode.Range(
            document.positionAt(context.valueRange[0]),
            document.positionAt(context.valueRange[1]),
          ),
        )
      : '';
    const sources =
      parameter?.field && context.role === 'key'
        ? [parameter.source]
        : this.sources(match, context, document.offsetAt(position), rawValue);
    const locations: vscode.Location[] = [];
    for (const source of sources) {
      try {
        const filename = await containedPath(match.project.root, source.path);
        locations.push(
          new vscode.Location(
            vscode.Uri.file(filename),
            source.range
              ? new vscode.Range(
                  source.range.start.line,
                  source.range.start.character,
                  source.range.end.line,
                  source.range.end.character,
                )
              : new vscode.Position(0, 0),
          ),
        );
      } catch {
        /* Invalid or escaped references never become navigation targets. */
      }
    }
    return locations;
  }
  private hover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const match = this.forUri(document.uri);
    if (!match?.schema) return undefined;
    const context = this.cursor(document, position);
    if (!context) return undefined;
    const parameter = parameterContext(document.getText(), context, match.project.catalog);
    if (parameter?.field?.description) {
      const markdown = new vscode.MarkdownString();
      markdown.appendText(parameter.field.description);
      return new vscode.Hover(markdown);
    }
    if (context.suppressed || !context.actionType || !context.actionPath) return undefined;
    const field = context.path
      .slice(context.actionPath.length)
      .filter((part) => typeof part === 'string')
      .join('.');
    const definition = match.project.catalog?.actions.find(
      (item) =>
        item.type === context.actionType &&
        (!context.actionSubtype || item.subtype === context.actionSubtype),
    );
    const help = definition?.fields.find((item) => item.name === field);
    if (!help?.description) return undefined;
    const markdown = new vscode.MarkdownString();
    markdown.appendText(help.description);
    return new vscode.Hover(markdown);
  }
  private quickFixes(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const match = this.forUri(document.uri);
    if (!match?.schema || !['authoring', 'template', 'blueprint'].includes(match.schema)) return [];
    const context = this.cursor(document, range.start);
    if (!context || context.suppressed || context.role !== 'value' || !context.actionPath)
      return [];
    const key = context.path.at(-1);
    if (typeof key !== 'string' || !/(?:file|path)$/.test(key)) return [];
    const before = context.value;
    if (!before?.startsWith('./')) return [];
    const replacement = before.slice(2);
    if (!match.project.inventory?.files.some((file) => file.path === replacement && file.exists))
      return [];
    if (!context.valueRange) return [];
    const [start, end] = context.valueRange;
    if (
      document.getText(new vscode.Range(document.positionAt(start), document.positionAt(end))) !==
      before
    )
      return [];
    const fix = new vscode.CodeAction(
      'Use project-relative resource path',
      vscode.CodeActionKind.QuickFix,
    );
    fix.command = {
      command: 'lhp.language.applyQuickFix',
      title: fix.title,
      arguments: [
        {
          uri: document.uri.toString(),
          version: document.version,
          start,
          end,
          before,
          replacement,
        } satisfies QuickFixRequest,
      ],
    };
    return [fix];
  }
  private async applyQuickFix(request: QuickFixRequest): Promise<void> {
    if (!vscode.workspace.isTrusted)
      throw new Error('Trust this workspace before editing LHP source.');
    if (
      !request ||
      typeof request.uri !== 'string' ||
      !Number.isSafeInteger(request.version) ||
      !Number.isSafeInteger(request.start) ||
      !Number.isSafeInteger(request.end) ||
      request.start < 0 ||
      request.end < request.start ||
      request.end - request.start > 4096 ||
      typeof request.before !== 'string' ||
      typeof request.replacement !== 'string' ||
      request.replacement !== request.before.slice(2) ||
      !request.before.startsWith('./')
    )
      throw new Error('Invalid LHP quick fix request.');
    const uri = vscode.Uri.parse(request.uri);
    const match = this.forUri(uri);
    if (
      !match?.schema ||
      !['authoring', 'template', 'blueprint'].includes(match.schema) ||
      !match.project.inventory?.files.some(
        (file) => file.path === request.replacement && file.exists,
      )
    )
      throw new Error('Quick fix no longer matches a known LHP resource.');
    await containedPath(match.project.root, match.relative);
    const document = await vscode.workspace.openTextDocument(uri);
    if (
      request.end > document.getText().length ||
      document.version !== request.version ||
      document.getText(
        new vscode.Range(document.positionAt(request.start), document.positionAt(request.end)),
      ) !== request.before
    )
      throw new Error('The YAML document changed. Recompute the quick fix.');
    const context = this.cursor(document, document.positionAt(request.start));
    if (!context) throw new Error('The YAML document is too large or invalid for this quick fix.');
    const key = context.path.at(-1);
    if (
      context.suppressed ||
      context.valueRange?.[0] !== request.start ||
      context.valueRange?.[1] !== request.end ||
      typeof key !== 'string' ||
      !/(?:file|path)$/.test(key) ||
      !context.actionPath
    )
      throw new Error('Quick fix no longer matches the expected LHP field.');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(request.start), document.positionAt(request.end)),
      request.replacement,
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not apply the quick fix.');
  }
  dispose(): void {
    this.projects.clear();
    this.schemas.clear();
    this.parses.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
