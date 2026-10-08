# Implementation checklist

## 0.1.2 native Project tree and command shortcuts

- [x] Contribute one native LHP Activity Bar container and lazy Project tree, using the existing designer and guarded native source navigation.
- [x] Add tree title, overflow and context actions for existing commands without assigning global keyboard shortcuts.
- [x] Add project/revision-checked graph selection and clear the previous project graph during a new-project bootstrap.
- [x] Cover lazy hierarchy, inactive projects, shared-source files, stale/forged references, same-revision file replacement and view states in unit tests.
- [x] Pass real VS Code tree/source/multi-document/rapid-selection integration and webview focus tests on the updated source.
- [x] Complete three-platform CI, production audit and packaged 0.1.2 VSIX inspection; record exact revision, artifact link and checksum.

Local Linux ARM64 verification on 8 October 2026: typecheck, lint, formatting and build passed; 48 unit/React/adapter tests across 12 files passed, six Python bridge tests passed, production audit reported zero vulnerabilities, and the real VS Code 1.106.0/Red Hat YAML 1.24.0 extension-host suite exited successfully. The sidebar suite exercised actual TreeView focus/reveal without another refresh, native multi-document YAML opening, stale references, rapid selection before the designer ready handshake and inactive-project isolation. The synthetic model check retained 4,017 flowgroups and 18,766 actions without creating action rows until their flowgroup was expanded. The [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725124804) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725127161) both passed on Windows, macOS and Linux at `d70151ed26bdb0459d19db19d01761eb75ccb228`. Each platform passed all 48 tests without skips, six Python bridge tests and real VS Code integration. Actual native workbench captures checked dark and light themes.

The delivered [CI-produced 0.1.2 artifact](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725124804/artifacts/11526939315) is `.tmp/lhp-vscode-0.1.2.vsix`, with 18 allowlisted files, 232,044 bytes and SHA256 `02a64660e4338bdfeef3fc56e361e23d8b0cf50358fca1e1f106e73417e7553d`. The native Activity Bar SVG is included; development dependencies, tests and local paths are excluded. Later delivery commits update documentation only. YAML language features are unchanged; the guide distinguishes existing help from suggested future improvements.

## 0.1.1 reported refresh/notice defects
- [x] Reproduce original oversized response and preserve full canonical graph counts.
- [x] Remove duplicate transport data, keep the 32 MiB byte budget, reject malformed/truncated UTF-8 safely, and support graph arrays above 10,000 nodes.
- [x] Publish current runtime health independently; distinguish loading, cancellation, transport failure and real source diagnostics.
- [x] Collapse long notices and virtualize large graph views; verify synthetic 84-notice/4,017-flowgroup layouts.
- [x] Run actual read-only performance-project refresh in VS Code: 4,017 flowgroups, 18,766 actions, 17,961 action edges and 2,813 document versions.
- [x] Complete patch desktop CI and audit/deliver `lhp-vscode-0.1.1.vsix`.

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

Verified runtime revision: `8bea221e441c2f587847f01830168f32a9a9e733`. Both the [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37718088291) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37718092308) passed on Linux, macOS and Windows on 8 October 2026. Each platform passed typecheck, lint, formatting, build, 39 tests with no skips, six Python bridge tests (including three real lifecycle/scaffold/boundary tests), actual VS Code 1.106.0/Red Hat YAML 1.24.0 integration and the production dependency audit (zero vulnerabilities). Native integration includes undo/redo, blueprint parameters, preview expiry, nested-project discovery and bundle generation. Local Linux ARM64 host integration also passed.

The delivered VSIX is the audited Linux push-build artifact, with 17 allowlisted files and 227,898 bytes. SHA256: `323fc36e5762a98de336f4660f6f6cc98e34d48a87f795757e39f967e572207c`. Its README links use the exact source revision. [Extension draft PR #1](https://github.com/Mmodarre/lhp-vscode/pull/1) remains unmerged and there is no Marketplace publication. [Core PR #290](https://github.com/Mmodarre/Lakehouse_Plumber/pull/290) was merged upstream by the time of final verification; the extension still pins the reviewed core commit above. Documentation-only delivery updates follow the verified runtime revision.
