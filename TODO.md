# Implementation checklist

## Repository and shared contract
- [x] Confirm new local and public repository names do not already exist.
- [x] Create repository, Apache licence, scoped rules and implementation plan.
- [ ] Publish and agree shared protocol with GUI/core implementers.
- [ ] Initialise public remote, commit plan and push main; create feature branch.
- [ ] Add package, build, lint/typecheck/test and CI scaffolding.

## Host and adapter
- [ ] Trusted project discovery and per-project/environment context.
- [ ] Interpreter detection/selection; compatible version/capability diagnostics.
- [ ] Guided venv/install, existing local runtime, project creation and bronze ingestion.
- [ ] Bounded NDJSON process transport, cancellation and structured errors.
- [ ] Public-API-only Python adapter; matching installed schemas and catalogue.
- [ ] YAML/source navigation, completion/help and Problems.
- [ ] Version-checked native document edits; comment retention; undo/redo synchronisation.
- [ ] Read-only preview and explicit saved/full-project generation.
- [ ] Databricks extension/project handoff, no remote execution.

## GUI integration
- [ ] Pipeline and flowgroup navigation; action graph.
- [ ] Add/delete/duplicate/configure/connect/disconnect actions.
- [ ] Native SQL/Python/schema/expectations/config source opening per action.
- [ ] Template and blueprint instance navigation and supported editing.
- [ ] Catalogue-driven guided forms and YAML synchronisation.
- [ ] Environment/project/runtime state, stale state, errors and unsupported capabilities.

## Verification and delivery
- [ ] Unit and integration tests (protocol, paths, edits, bridge).
- [ ] Extension-host and GUI interaction tests.
- [ ] Typecheck/lint/build and production dependency audit.
- [ ] Three-OS CI configured and results inspected.
- [ ] VSIX built and contents audited.
- [ ] README/setup/limitations and third-party notices complete.
- [ ] Parent review issues resolved.
- [ ] Commit/push implementation and open draft PR; report VSIX and evidence.

Core E2E tests/fixtures/baselines: unchanged; any change requires user approval.
