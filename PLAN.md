# LHP VS Code implementation plan

Status: implementation and desktop verification complete. Delivery: audited VSIX and reviewable public source in the extension draft PR, no extension merge or Marketplace publication.

## Product and release boundary

Desktop VS Code on macOS, Windows and Linux; LHP 0.9.3 integration build. Native YAML, SQL, Python and related source files remain authoritative. Guided onboarding, graph manipulation and forms serve the same documents as code-first workflows. Remote/browser support and remote Databricks execution are outside this release.

All graph capabilities are in scope: project pipelines, pipeline-to-flowgroup drilldown, action graphs, add/delete/duplicate/configure/connect/disconnect, source file opening, template/blueprint instance navigation and supported editing. No silent feature reduction; generated or unsupported nodes explain the restriction and provide the editable source.

## Architecture

- TypeScript extension host owns project discovery, interpreter selection, trust, subprocess lifecycle, document edits, Problems, completion/navigation, previews, generation and Databricks handoff.
- React/XYFlow webview owns graph/forms presentation and sends allowlisted semantic requests. It never writes files directly or stores a parallel document.
- Bundled Python NDJSON bridge imports LHP public APIs; selected interpreter loads the user's compatible LHP. Request IDs, operation errors and progress are structured.
- Shared `src/shared/protocol.ts` defines the webview contract and bridge envelope. Runtime validation rejects unknown operations and malformed messages.
- YAML syntax/schema support composes with Red Hat YAML. LHP schemas and catalogue match the installed runtime. Domain semantics stay in core.
- Edits reject stale document versions and use YAML CST to preserve comments/unknown fields where possible. Async responses are tied to project/environment/revision.
- Preview uses a public core preview API with isolation guarantees and capability reporting. Full generation uses saved files and explicitly states project/environment/output scope.

## Milestones, ownership and acceptance

1. **Repository and contract — extension lead.** Apache licence/notices, repo rules, plan/TODO, shared typed messages, npm/build layout. Acceptance: GUI and core peers acknowledge the contract and no existing checkout is overwritten.
2. **Core editor surface — core implementer.** Public snapshot/catalogue/source provenance/overlay validation and preview where supportable. Acceptance: frozen serialisable DTOs, source ranges, read-only behaviour, API tests and existing quality gates. Do not modify E2E fixtures/baselines.
3. **Host foundation — extension lead.** Discovery, per-project contexts, selected Python, version/capability checks, trusted NDJSON transport, onboarding, schema support. Acceptance: meaningful process/path/protocol tests; unavailable runtime gives actionable setup, not blank UI.
4. **Graph and forms — GUI implementer with host integration.** All graph operations, native source-file actions, template/blueprint navigation, schema-driven forms. Acceptance: edits reflected in both views; stale edits rejected; undo/redo resynchronises; unsupported generated nodes explain why.
5. **Authoring workflows — extension lead.** Problems, completions/help, preview, environment selection, explicit full generation, Databricks handoff. Acceptance: unsaved buffer semantics clear; preview does not mutate project; destructive scope visible; no remote execution.
6. **Verification and delivery — extension lead, parent review.** Three-OS CI, package inspection, audit, tests, README and VSIX. Acceptance: source committed/pushed, draft PR, all feasible gates pass, limitations evidenced; no Marketplace publication.

## Test strategy

- Unit tests: message allowlist, JSON/protocol bounds, YAML CST edits and comment retention, document-version conflicts, project/path containment and generation guards.
- Python bridge tests: health/capability failures, API-only boundary, request validation, structured errors, fixture-based integration through compatible LHP when available.
- Extension-host tests: activation/commands, trusted per-project workflow, WorkspaceEdit and undo/redo, native source opening, diagnostics and virtual previews. Use repository-owned temporary fixtures. These are extension tests, not modifications to core E2E.
- GUI tests: reducer/form/graph transformations, interactions and stale-response handling, plus typecheck/build.
- Packaging: `vsce package --no-dependencies`; inspect archive for bridge, webview, schemas, icons/licences and absence of credentials, scratch files, dependencies or local paths.
- CI: Node and Python on ubuntu/windows/macos; unit/bridge/type/lint/build/package checks; real extension host under Linux Xvfb and desktop runners as supported. Explicitly report any runtime/environment blockers rather than masking failures.

## Dependencies and risks

- Core editor APIs and accurate provenance determine graph editability and template navigation. Host can edit raw YAML mechanically but must not invent core semantics.
- LHP 0.9.3 is unreleased: installation UI must support an existing compatible interpreter and an explicit local wheel/source path, without pretending a PyPI release exists.
- Current core full generation replaces environment output. All generation entry points use one explicit full-project confirmation and require saved source files.
- Preview parity must be documented by capabilities. An incomplete plan is never presented as final generated output.
- Validation source ranges and action source-file metadata are required for useful Problems and native editor handoff.
- GUI and host must coordinate on protocol changes; add backward-compatible fields or update both atomically.

## Decision log

- 2026-10-08: user authorised public `Mmodarre/lhp-vscode`, Apache-2.0, implementation, commit and push; VSIX first; no Marketplace.
- 2026-10-08: balanced forms and YAML accepted; all graph operations required in first release; desktop only; core work isolated on `feature/vscode-integration`.
- 2026-10-08: core E2E modifications require separate explicit approval.

## Concrete acceptance scenarios and recorded status

- **No project / missing Python:** open designer with a clear setup state; choose existing Python or create an isolated venv; incompatible PyPI 0.9.2 offers the pinned integration build. No project code runs before workspace trust. UI and setup unit checks cover these branches; the real interpreter/adapter lifecycle is integration-tested.
- **New project and bronze:** create an absent or empty target. Bundle setup asks for explicit catalog/schema and writes active pipeline configuration. Bronze requires a fully qualified target. Native YAML appears, canonical validation succeeds, preview includes draft changes and full generation produces source and bundle resources. Real Python and VS Code tests cover the lifecycle.
- **Multi-project context:** store interpreter, environment and pipeline config per LHP root, including nested roots in one workspace folder. Switching context invalidates in-flight output. Existing project creation outside the workspace is selected explicitly after the folder addition.
- **Native/visual round trip:** modify an action form, observe dirty YAML, undo and redo through VS Code, reject a stale version, and refresh from a native edit. Unit tests cover nested comments, Unicode, duplicate names and mapping-array/multi-document source addresses; native integration covers edits and undo/redo.
- **Invalid YAML / empty graph:** retain last valid graph with a stale marker and disable graph writes. Native source opening and undo stay available. Empty valid projects expose creation paths. Unsupported root sequences surface the actual LHP parser diagnostic.
- **Template/blueprint scope:** qualified nested template names and required parameters appear from the installed catalogue. Blueprint invocation parameters remain editable while generated action lists remain read-only. Native integration verifies parameter change updates the resolved graph.
- **Preview:** use unsaved YAML/SQL/Python/config overlays in an isolated mirror; never write the user's output. Read-only preview expires immediately when inputs change. Explicit parity notices explain bundle/monitoring/sandbox/wheel limitations.
- **Generation:** one native confirmation, save all authored project documents, recheck source state, run full project into the selected environment output, and synchronise an enabled bundle. The generated-file watcher cannot cancel the writer's own operation; actual host tests verify generated Python and bundle resource files.
- **Cancellation and security boundaries:** reject unknown messages/traversal/symlink escape; a real subprocess test kills a Python child and its descendant. Desktop host tests use a real vendor YAML extension in an isolated profile.

The public editor API dependency is pinned to core commit `98d285ab8a7606867abb5708f2715ebe31a9befc`, reviewed and pushed on 8 October 2026. Core package metadata remains 0.9.2; capability checks and installation text explicitly distinguish the unreleased integration build.

## Delivery evidence

### 0.1.1 large-project refresh correction

The reported Refresh failure was reproduced numerically on the public performance example: the original response was 39,091,446 bytes and a second guard rejected arrays above 10,000 graph nodes. The patch projects only fields consumed by the editor, keeps every action/edge/raw/source field, uses a linear byte-bounded decoder with strict UTF-8, and separates runtime health from graph loading/failure. Canonical graph conversion uses indexed lookups; pipeline summaries and document-state messages no longer duplicate complete detail/source bodies. Notice expansion is bounded and graph nodes are virtualized.

Independent core and host checks preserve all 4,017 flowgroups, 18,766 actions, 17,961 action edges and 3,212 flowgroup edges. The projected NDJSON response is 29,469,965 bytes; the existing 32 MiB budget has 12.17% headroom and remains an explicit supported-size boundary. Actual read-only VS Code inspection passed with 2,813 document versions in 145.09 seconds. No original project files or core APIs/E2E files were modified. Patch desktop CI and the versioned VSIX are tracked in TODO.md.

All six milestones are implemented. Runtime revision `4ff6ec54608cb5f93f5734ee49dd403c90929d52` passed the [three-platform CI matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37713497951) on 8 October 2026: 31 unit/React/adapter tests without skips, three real bridge lifecycle tests, real VS Code host integration on Linux, macOS and Windows, type/lint/format/build gates and zero production dependency vulnerabilities. The Linux job packaged and audited the delivered VSIX; TODO.md records its checksum and PR links.

The accepted desktop authoring scope is shipped. Browser/remote-host support and remote Databricks execution remain outside the user-approved release boundary. Code-derived dependency edges and generated/template/blueprint action bodies navigate to their real source or configuration when direct edge/action mutation is unsupported. Preview remains source-only with explicit bundle, monitoring, sandbox and wheel parity limits; full generation is available separately. These are documented capability boundaries, not hidden successful-preview or deployment claims. No delivery blocker remains, and core E2E files are unchanged.
