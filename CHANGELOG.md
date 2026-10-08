# Changelog

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
