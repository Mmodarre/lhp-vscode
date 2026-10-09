# 0.3.1 GitHub pre-release delivered; Marketplace checks pending

Target extension ID: **`MEHDIMODARRESSI.lhp-vscode`**. This is distinct from the earlier `Mmodarre.lhp-vscode` VSIX identity. [Manual-first release guide](docs/marketplace-release.md) defines the exact main/CI/tag/GitHub artifact handoff, first Marketplace upload and later authentication boundary. A GitHub pre-release or green CI is not a live Marketplace listing.

- [x] Prepare Marketplace-facing README, support and 0.3.1 changelog copy with Python 3.11+, reviewed Git core capability, existing-environment repair, source-only preview and generation replacement limits.
- [x] Capture four unedited native VS Code screenshots using an audited packaged VSIX and a synthetic project; include sidebar, action graph, native SQL/YAML and Sandbox On/Show all without customer data or local paths.
- [x] Finalize 0.3.1 publisher/package metadata, pre-release manifest, clean-source VSIX provenance and exact-CI-artifact GitHub release workflow; independently review and run focused regressions.
- [x] Pass required local gates and Linux/macOS/Windows CI on the final source; audit the 0.3.1 VSIX, README image links, support/licence/notice inclusion, checksum and release sidecars.
- [x] Merge reviewed source to `main`, pass main push CI, tag the exact commit and run the guarded GitHub pre-release handoff with the matching CI run ID.
- [x] Create/verify publisher ID `MEHDIMODARRESSI` (confirmed by the account holder; this environment did not access the publisher portal).
- [ ] Manually upload the exact GitHub pre-release VSIX under `MEHDIMODARRESSI`, verify the live listing and install it from Marketplace in an isolated desktop profile. Record the result and identity-migration behavior. No automated Marketplace authentication or upload is configured.

The four screenshots were captured on VS Code 1.106.0 from the audited 0.3.0 VSIX; 0.3.1 carries that authoring UI forward while changing publisher/release metadata. The source fixture and native profile are isolated under `.tmp/`. The user's Mac project has not been accessed or installed from this Linux session.

The reviewed 0.3.1 source was merged as [main commit `531c474ecaa54efd86c194af3c156d060e93880d`](https://github.com/Mmodarre/lhp-vscode/commit/531c474ecaa54efd86c194af3c156d060e93880d) and tagged `v0.3.1`. [Main CI `37868415981`](https://github.com/Mmodarre/lhp-vscode/actions/runs/37868415981) passed its Ubuntu, macOS, Windows and package jobs; the [guarded release workflow `37869207986`](https://github.com/Mmodarre/lhp-vscode/actions/runs/37869207986) passed and produced the [immutable GitHub pre-release](https://github.com/Mmodarre/lhp-vscode/releases/tag/v0.3.1). Its universal VSIX is the exact [main CI artifact `11588619123`](https://github.com/Mmodarre/lhp-vscode/actions/runs/37868415981/artifacts/11588619123): **25 allowlisted files, 301,706 bytes, SHA256 `945195e60fb71d054983abb86a67ef7901c044cdef5f66d07ae8209fd8b1e9bf`**. Independent checks covered archive CRC, package identity `MEHDIMODARRESSI.lhp-vscode@0.3.1`, pre-release marker, committed media/bridge bytes, immutable README screenshot links, reviewed core pin, clean provenance, checksum sidecar and a public unauthenticated download matching the CI bytes. GitHub release attestation verification passed. This GitHub release is a download and manual-upload handoff, **not** a live Marketplace listing.

The exact CI VSIX was installed into a fresh isolated Linux ARM64 VS Code 1.106.0 profile with Red Hat YAML 1.24.0 and synthetic two-pipeline project. The new extension ID activated; LHP empty-folder welcome and its own Get Started walkthrough opened; designer graph and physical YAML source opened; Sandbox On selected one of two pipelines, while Show all marked the other outside scope without changing the sandbox generation label; YAML offered `load`, `test`, `transform` and `write` completions. Scratch captures are under `.tmp/marketplace-031-smoke/`. This verifies the VSIX from CI, **not** installation from Marketplace or the user's Mac project.

---

# 0.3.0 delivery checklist

Delivery is complete for runtime `11f9095258d4cc59054ab5ad0eb021f188d4425e`. The earlier runtime `0e2e461060cf4c8e8370d487aab32327380d918b` and its VSIX are superseded for installation: pip could retain an older same-version core during an existing-environment repair. The final installer explicitly reinstalls the reviewed Git build when the user chooses **Install or repair LHP in this environment** and verifies `sandbox_editor` before reporting success. A disposable same-version Git/pip test reproduced the old behavior and verified the repair.

Approved scope and phase acceptance: [docs/0.3-implementation-plan.md](docs/0.3-implementation-plan.md). The evidence below records completed verification and its limits.

- [x] A: verify the public core sandbox contracts at reviewed commit `4a53d72a96c386a12ff237fc0105a31266007f39` and finalize extension protocol v2; retain the native 0.2.1 trust boundary.
- [x] B: implement/test canonical saved and draft `.lhp/profile.yaml` scope, policy resolution, errors, source-only preview and truthful output limits in isolated core/bridge.
- [x] C: add every actual source under each consuming flowgroup; canonical Resources, known shared usages, exact source/parameter context and uncertainty.
- [x] D: implement coordinated original 16px LHP pipeline/flowgroup icons and theme-native SQL/Python file icons; inspect dark/light/high-contrast native captures.
- [x] E: implement host-owned Sandbox Off/On state, native profile configuration/scope, selected-pipeline default view and display-only Show all; render from typed host facts.
- [x] F: label draft validation/source preview and excluded artifacts accurately; confirm both modes replace `generated/<environment>`, sandbox syncs managed `resources/lhp`, and only verified extension writes get a “Last generated by extension” mode/profile label while external or older output remains unknown.
- [x] G: meaningful core/bridge/host/GUI and installer regressions, native smoke, required local gates, three-OS CI, production audit and canonical VSIX inclusion/secret audit.

No core E2E tests, fixtures or baselines were edited. The original Lakehouse_Plumber checkout and existing LHP logo remain unchanged.

Runtime **`11f9095258d4cc59054ab5ad0eb021f188d4425e`** passed the [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37864145910) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37864149676) on **Linux, macOS and Windows** on 9 October 2026. The PR matrix passed on its second attempt after a transient macOS npm registry DNS failure; the native suite had passed in the first attempt. The final matrices passed typecheck, lint, formatting, build, the real VS Code 1.106.0/Red Hat YAML 1.24.0 extension-host suite, Python bridge tests and production audit with **zero vulnerabilities**. Local Linux ARM64 verification passed **123 unit/React/real-adapter tests without skips**, **15 Python bridge tests**, package audit and the native suite on reviewed core commit **`4a53d72a96c386a12ff237fc0105a31266007f39`**. The separate [core PR #303](https://github.com/Mmodarre/Lakehouse_Plumber/pull/303) CI passed on that immutable core commit; no existing core E2E tests, fixtures or baselines were edited.

The native sandbox lifecycle exercised a separate child project through saved profile, Sandbox On, unsaved profile scope, out-of-scope native edit under Show all, scoped preview, saved profile and scoped generation. An isolated trust-enabled 720px two-pipeline smoke showed shared SQL in two flowgroups with both known uses, Show all as display-only, full-width source preview and only bronze output after sandbox generation. The original 16px icon pair was visually reviewed in actual dark, Default Light Modern and Default High Contrast VS Code themes; all seven Resources categories were visible at 720px. The read-only public performance check was measured on preceding runtime `0e2e461060cf4c8e8370d487aab32327380d918b`, whose graph path is unchanged by the installer-only follow-up. It preserved **4,017 flowgroups, 18,766 actions, 17,961 action edges, 3,212 flowgroup edges and 2,814 document versions** in **22.357 seconds**, with a **39,365,466-byte webview snapshot** and **436,228,096-byte host RSS** in the shared Linux ARM64 environment; these are measurements, not fixed guarantees or a new measurement on `11f9095`.

The historical [CI-produced 0.3.0 VSIX](https://github.com/Mmodarre/lhp-vscode/actions/runs/37864145910/artifacts/11586914551) was **`.tmp/lhp-vscode-0.3.0.vsix`**, artifact **11586914551**, containing **24 allowlisted files / 299,429 bytes**, SHA256 **`d43fa97a1be247caf39a0e727787b4378b265b4fec61462c02269f5ee2d8cbf1`**. Independent archive verification checked CRC, extension version, five native views, committed brand and semantic SVG bytes, both Python bridge modules, the exact published core pin, bundled repair reinstall and capability postcondition, and exclusion of private/development files. It superseded earlier 0.3.0 builds but has since been superseded for installation by the 0.3.1 GitHub pre-release above. Installation into the user's Mac project was not performed: this Linux session has no Mac execution bridge. macOS CI is verification of the extension suite, not proof of that project installation. At the 0.3.0 handoff, PR #1 was still unmerged and no Marketplace publication had occurred; its later merge and 0.3.1 GitHub release are recorded above.

---

# Patch 0.2.1 acceptance checklist

- [x] Replace the onboarding trust dead end with native Manage Workspace Trust and explicit retry.
- [x] Keep untrusted cancellation and trust-manager navigation free of Python, settings and project writes.
- [x] Reject changed trust/workspace/project scope before delayed onboarding work or new-root attachment.
- [x] Add focused controller/onboarding regressions and trusted retry coverage.
- [x] Complete type/lint/format/build/unit/bridge/native/audit/package gates and independent review.
- [x] Verify desktop CI, commit/push and deliver the audited 0.2.1 VSIX with exact evidence.

Local Linux ARM64 verification on 8 October 2026: typecheck, lint, formatting and build passed; 101 unit/React/real-adapter tests across 20 files and ten Python bridge tests passed; native VS Code 1.106.0 / Red Hat YAML 1.24.0 integration exited successfully; the production audit reported zero vulnerabilities. A separate isolated native empty-folder test kept workspace trust enabled and verified prompt dismissal, native trust management without continuation, granting trust without automatic work, and a fresh Create Project retry reaching the interpreter picker. Independent code review found no remaining trust-boundary blocker. Packaging passed the 20-file allowlist audit. Both the [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37857956889) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37857960668) passed on Linux, macOS and Windows at runtime commit **`42a2323e267d325bf52a00a6561ed7b71a9661af`**, including all 101 tests without skips, ten bridge tests, native integration and the zero-vulnerability production audit.

The delivered [CI-produced 0.2.1 VSIX](https://github.com/Mmodarre/lhp-vscode/actions/runs/37857956889/artifacts/11584728249) is **`.tmp/lhp-vscode-0.2.1.vsix`**, artifact **11584728249**, with **20 allowlisted files / 285,211 bytes** and SHA256 **`99999a7004da5e498f89d8b85dfd31692ac745b1154017cca1cc808cc4399597`**. The canonical CI artifact was downloaded and independently checked for archive integrity, version, trust-command enablement, native trust navigation, source-linked README and absence of private/development files. Subsequent documentation commits do not change the tested runtime or artifact bytes. The draft PR remains unmerged; no Marketplace publication or core/E2E changes occurred.

Previous 0.2.0 verification and artifact identity below remain historical.

---

# Active 0.2.0 acceptance checklist

Approved final v3 design: [scope and decisions](docs/sidebar-redesign.md). No phase is silently deferred. Historical 0.1.x evidence follows this active checklist.

- [x] Record approval, ownership, source-of-truth design and typed resource/dataset/inspection contracts.
- [x] A: bounded contained physical index; runtime-independent browse; configured/declared path classification; independent catalogue and live context.
- [x] B: five native views, remembered state/search, source-authoritative actions, help/welcome and runtime/trust/stale states.
- [x] C: canonical project/data views; draft template, saved config, preset/substitution inspections; generated inventory and native compare.
- [x] D: exact LHP assets/palette, project/dataset designer, first-flowgroup guides, contextual help and TPC-H bootstrap.
- [x] E: scoped YAML classification, CST context, references/tokens/files, snippets, precise hover/definitions and safe deterministic fixes.
- [x] Verify complete design matrix, including honest wheel/sandbox/cloud/filter boundaries and every resource/config home.
- [x] Focused unit/bridge/native integration gates; no E2E changes without explicit user approval.
- [x] Final type/lint/format/build/tests/audit; all three desktop CI jobs; VSIX asset/path/secret audit.
- [x] Root independent review, coordinated scoped commits/push, truthful docs/evidence and audited 0.2.0 VSIX delivery.

Runtime **`c931f99a62eb4e3a4f668e18d5d096d006e2afd4`** passed both the [push matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736437280) and [PR matrix](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736442314) on **Linux, macOS and Windows** on 8 October 2026. Each platform passed typecheck, lint, formatting, production build, **84 unit/React/real-adapter tests across 19 files without skips**, **ten Python bridge tests**, the real VS Code 1.106.0 / Red Hat YAML 1.24.0 integration suite and the production dependency audit with **zero vulnerabilities**. Native coverage includes five-view navigation, structural YAML providers, template/config/preset inspection, generated-source provenance/diff, Windows preview path spelling, native draft creation, undo/redo, stale guards, overlapping discovery and nested-project isolation. Root independently reviewed the implementation, native dark/light/high-contrast captures, CI results and final archive.

The read-only public performance check preserved **4,017 flowgroups, 18,766 actions, 17,961 action edges, 3,212 flowgroup edges and 2,813 native document versions**. It completed in **20.119 seconds**, with **41,921,057 bytes** in the webview snapshot and **445,960,192 bytes** host RSS in that shared Linux ARM64 run. These are measurements, not fixed performance guarantees. The Python decoded-response budget remains 32 MiB and never truncates a graph. Physical inventory, classification, YAML assistance and Data inspection keep their separately documented bounds. Core, website and existing E2E files were unchanged; the original dirty checkout was preserved.

The delivered [CI-produced 0.2.0 VSIX](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736437280/artifacts/11532285880) is **`.tmp/lhp-vscode-0.2.0.vsix`**, artifact **11532285880**, containing **20 allowlisted files / 284,416 bytes**, SHA256 **`4b47ff72b004afb7d53ea4b329a88ce58bd01d0ae71ea84497bdf28a491488e8`**. Independent checks confirmed version 0.2.0, exactly five native views, the exact approved LHP brand assets, both Python bridge modules, archive integrity and exclusion of private paths, development dependencies, source maps, tests and scratch data. The artifact is from runtime commit `c931f99a62eb4e3a4f668e18d5d096d006e2afd4`; subsequent delivery documentation commits do not change its bytes. [PR #1](https://github.com/Mmodarre/lhp-vscode/pull/1) remains unmerged, with no Marketplace publication.

---

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
