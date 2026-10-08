# Implementation checklist

## Repository and shared contract
- [x] Confirm new local and public repository names do not already exist.
- [x] Create repository, Apache licence, scoped rules and implementation plan.
- [x] Publish and agree shared protocol with GUI/core implementers.
- [x] Initialise public remote, commit plan and push main; create feature branch.
- [x] Add package, build, lint/typecheck/test and CI scaffolding.

## Host and adapter
- [x] Trusted project discovery and per-project/environment context.
- [x] Interpreter detection/selection; compatible version/capability diagnostics.
- [x] Guided venv/install, existing local runtime, project creation and bronze ingestion.
- [x] Bounded NDJSON process transport, cancellation and structured errors.
- [x] Public-API-only Python adapter; matching installed schemas and catalogue.
- [x] YAML/source navigation, completion/help and Problems.
- [x] Version-checked native document edits; comment retention; undo/redo synchronisation.
- [x] Read-only preview and explicit saved/full-project generation.
- [x] Databricks extension/project handoff, no remote execution.

## GUI integration
- [x] Pipeline and flowgroup navigation; action graph.
- [x] Add/delete/duplicate/configure/connect/disconnect actions.
- [x] Native SQL/Python/schema/expectations/config source opening per action.
- [x] Template and blueprint instance navigation and supported editing.
- [x] Catalogue-driven guided forms and YAML synchronisation.
- [x] Environment/project/runtime state, stale state, errors and unsupported capabilities.

## Verification and delivery
- [x] Unit and integration tests (protocol, paths, edits, bridge).
- [x] Extension-host and GUI interaction tests.
- [x] Typecheck/lint/build and production dependency audit.
- [ ] Three-OS CI configured and results inspected.
- [x] VSIX built and contents audited (17 allowlisted files; rebuilt at final delivery).
- [x] README/setup/limitations and third-party notices complete.
- [x] Parent review issues resolved; final CI results still pending.
- [ ] Commit/push implementation and open draft PR; report VSIX and evidence.

Core E2E tests/fixtures/baselines: unchanged; any change requires user approval.

Verified locally: real Python project lifecycle/scaffolds, pure and real-DTO adapter tests, React tests, and actual Linux ARM64 VS Code1.106.0/Red Hat YAML1.24.0 integration including native undo/redo, blueprint parameters, preview expiry and bundle generation. Desktop macOS/Windows execution awaits CI evidence. Packaging and final review gates remain tracked above.
