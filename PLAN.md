# LHP VS Code implementation plan

Status: implementation in progress. Delivery: installable VSIX and reviewable public source, no Marketplace publication or merge.

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
