# LHP VS Code contribution rules

- Product: a desktop VS Code extension for LHP 0.9.3, balancing native YAML editing with guided graph and forms. Preserve every accepted capability in PLAN.md; report blockers rather than silently dropping scope.
- The Python adapter imports only the public `lhp.api` surface, `lhp.errors`, installed package metadata/resources and standard or declared libraries. Never reach into LHP internals or scrape CLI text.
- The native VS Code TextDocument is the sole source of truth. Form/graph edits use document-version-checked WorkspaceEdits and native undo/redo. No embedded Monaco or second save store.
- Host/webview messages use the allowlist in `src/shared/protocol.ts`. Treat incoming payloads, paths and text as untrusted. Use a strict CSP, local webview resources and argument arrays for subprocesses.
- Project operations require workspace trust. Project scope, interpreter, runtime version and environment must be explicit. Cloud execution is outside this release; Databricks integration is a handoff.
- Generation is explicitly full-project and may replace generated output. Previews must never mutate the user's project. Do not infer preview parity from LHP's plan operation.
- Preserve the original Lakehouse_Plumber checkout and its dirty work. Core changes belong in the separate lhp-vscode-core worktree and obey that repository's constitution.
- Do not create, edit or regenerate core E2E tests, fixtures or baselines without explicit user approval. Unit, integration and extension-host tests in this repository are authorised. Escalate any required core E2E changes with a concrete rationale.
- Keep each source module focused and normally below 500 lines. Use strict TypeScript and explicit protocol types. Public API contracts, path/version checks and destructive-operation boundaries require meaningful tests.
- Keep credentials, local environment paths, virtualenvs, build output and scratch files out of Git. Use `.tmp/` for scratch. Preserve Apache and third-party notices when reusing code/assets.
- Required gates: typecheck, lint, build, unit tests, bridge tests, extension-host tests where supported, production dependency audit, VSIX asset/inclusion audit. CI must target macOS, Windows and Linux.
- Maintain PLAN.md and TODO.md as implementation progresses. Do not claim tests or native platforms verified when this environment could not run them.
- Scope ownership for the active implementation: extension lead owns `src/`, `bridge/`, root tooling, tests and docs; GUI implementer owns `webview/` plus delegated `src/onboarding.ts`, related setup helper modules and onboarding tests; core implementer owns only the isolated LHP core worktree. Coordinate shared contract changes before editing another owner's files.
