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
- [x] Three-OS CI configured and results inspected: Linux, macOS and Windows pass.
- [x] VSIX built and contents audited (17 allowlisted files; rebuilt at final delivery).
- [x] README/setup/limitations and third-party notices complete.
- [x] Parent review issues resolved; final runtime revision passes desktop CI.
- [x] Commit/push implementation and open draft PR; report VSIX and evidence.

Core E2E tests/fixtures/baselines: unchanged; any change requires user approval.

Verified runtime revision: `4ff6ec54608cb5f93f5734ee49dd403c90929d52`. Both the [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37713497951) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37713501894) passed on Linux, macOS and Windows on 8 October 2026. Each platform passed typecheck, lint, formatting, build, 31 tests with no skips, three real Python bridge tests, actual VS Code 1.106.0/Red Hat YAML 1.24.0 integration and the production dependency audit (zero vulnerabilities). Native integration includes undo/redo, blueprint parameters, preview expiry, nested-project discovery and bundle generation. Local Linux ARM64 host integration also passed.

The delivered VSIX is the audited Linux push-build artifact, with 17 allowlisted files and 224,660 bytes. SHA256: `9df3b0dcfeaa572846fc8dc132ec175f523807719899ea719a5b668289eb4f39`. Its README links use the exact source revision. [Extension draft PR #1](https://github.com/Mmodarre/lhp-vscode/pull/1) remains unmerged and there is no Marketplace publication. [Core PR #290](https://github.com/Mmodarre/Lakehouse_Plumber/pull/290) was merged upstream by the time of final verification; the extension still pins the reviewed core commit above. Documentation-only delivery updates follow the verified runtime revision.
