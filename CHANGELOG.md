# Changelog

## 0.3.0

- Add per-project Sandbox Off/On, native `.lhp/profile.yaml` setup, effective-scope review, and display-only Show all. Selected pipelines, namespace and environment now govern validation, source preview and confirmed generation through the reviewed LHP core APIs.
- Show physical source files beneath every consuming flowgroup, whole-project known-use counts and navigation, and clear labels for unresolved dynamic references. Add coordinated pipeline and flowgroup tree icons while retaining the existing LHP brand mark and theme-native SQL/Python file icons.
- Keep source preview scoped and draft-aware, disclose excluded final artifacts, and record only known generated-output mode/profile identity. Both full and sandbox generation replace the selected environment output and managed resources.
- Require the reviewed sandbox editor core capability for sandbox operations, enforce bounded `.lhp/profile.yaml` mirroring, and reject symlink or special-file profile paths before inspection or generation.

## 0.2.1

- In Restricted Mode, project creation and Python onboarding offer Manage Workspace Trust with explicit retry instructions. Opening trust management or dismissing the prompt does not start Python or write project files.
- Reject trust or workspace/project changes before delayed onboarding work and project attachment.

## 0.2.0

- Replace the initial single project tree with approved native Configuration, Pipelines, Resources, Data and Generated Output views for the selected project; use the exact LHP identity and accessible theme-aware designer styling.
- Browse bounded physical resources without Python or workspace trust, preserve malformed files, isolate nested projects and update edited resources incrementally.
- Add project dependency and table/sink lineage views, first-flowgroup and TPC-H guides, exact source navigation, resource consumers, read-only template/configuration/preset/substitution inspections and persisted-source preview comparison.
- Upgrade YAML assistance with scoped content-aware schemas, structural cursor context, catalogue action snippets, parameter/reference/file/token suggestions, hover/definitions and a deterministic version-checked path fix.
- Keep native documents authoritative, execution trust-gated, full generation explicit, previews expiring and generated provenance exact. No remote execution or core/E2E changes.

## 0.1.2

- Add a native Lakehouse Plumber Activity Bar Project tree for projects, pipelines, flowgroups, actions and related source files. Expand nodes on demand; opening the tree does not load inactive projects.
- Add tree title, overflow and item context shortcuts for the existing designer, refresh, validation, preview, generation, environment, setup and Databricks workflows. No default keyboard bindings are imposed.
- Focus the existing designer graph and inspector from a tree item, while opening YAML and related files in native VS Code editors. Reject stale tree references after project changes.
- Document the existing schema-backed YAML editing help and the current scope of LHP-specific value suggestions and definitions.

## 0.1.1

- Fix large-project refresh by projecting unused duplicate API data out of the wire response, validating canonical graph arrays independently of webview request limits, and decoding bounded UTF-8 output incrementally.
- Preserve all graph members and source/edit data; index canonical graph lookups in linear passes and send document versions instead of source text to the webview.
- Publish current interpreter health before project loading; distinguish failed/cancelled refresh from YAML errors and preserve usable retry state.
- Collapse long project notices and render only visible graph nodes so large projects remain navigable.
- Verified the public performance example in real VS Code: 4,017 flowgroups, 18,766 actions and 17,961 action dependencies. The transport remains bounded to 32 MiB per decoded response; the measured projected response is 29,469,965 bytes (12.17% headroom). Larger responses fail explicitly without truncating the graph.

## 0.1.0

Initial desktop VSIX for LHP 0.9.3 integration: native YAML authoring, guided
graphs/forms, project setup, validation, source preview and full generation.
See README.md for runtime compatibility and documented preview limitations.
