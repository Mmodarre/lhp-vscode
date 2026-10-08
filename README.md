# Lakehouse Plumber for VS Code

Author Lakehouse Plumber pipelines in native YAML and a synchronised graph designer. Guided forms use the same VS Code documents and undo history as your editor.

This integration targets desktop VS Code on macOS, Windows and Linux. Distribution is a downloadable VSIX; it is not published to the Marketplace. Version 0.1.2 adds a native Project tree and command shortcuts.

## Install

1. Download the [verified 0.1.2 VSIX artifact](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725124804/artifacts/11526939315) and extract `lhp-vscode-0.1.2.vsix`, or build it below.
2. In VS Code, run **Extensions: Install from VSIX…**. Install **YAML by Red Hat** if VS Code requests the dependency.
3. Open a trusted local folder. Choose the **Lakehouse Plumber** Activity Bar icon to browse projects, or run **LHP: Open Pipeline Designer** from the Command Palette.
4. Select an existing compatible Python environment or use **Set Up Python Environment**. Python 3.11 or newer is required.

The extension requires the unreleased LHP 0.9.3 editor integration build at commit [`98d285ab8a7606867abb5708f2715ebe31a9befc`](https://github.com/Mmodarre/Lakehouse_Plumber/commit/98d285ab8a7606867abb5708f2715ebe31a9befc). Its distribution metadata still reports `0.9.2`; compatibility checks verify the public editor API capabilities. The ordinary PyPI 0.9.2 package does not contain those APIs. Guided setup installs the exact integration commit in a chosen virtual environment. Git is required for that installation; a compatible local wheel or source checkout can also be selected.

[Read the user guide](docs/USER_GUIDE.md) for the complete first-pipeline and existing-project workflows.

## Authoring

- Browse projects, pipelines, flowgroups, actions and related files in a native, lazy Project tree. Open source in native editors or use **Open in Designer** on a tree item to focus its graph and inspector.
- Add, configure, duplicate and delete actions. Connect or disconnect directly declared dataset inputs; code-derived edges open their SQL/Python source for editing.
- Edit YAML beside guided forms. Changes use version-checked WorkspaceEdits, preserve unchanged mapping comments, and participate in native undo/redo.
- Create files-to-bronze ingestion and template/blueprint instances. Shared definitions and generated monitoring actions show their actual editing scope.
- Open referenced SQL, Python, schemas, expectations and configuration in native editors.
- Use installed-runtime YAML schemas, project value suggestions, action-field hover help, go-to-definition and Problems diagnostics in the native editor. Red Hat YAML supplies schema-driven completion and validation; LHP adds project-specific help.
- Use view-title and context-menu shortcuts for refresh, validation, preview, generation, environment and Python setup. Existing LHP commands can also be assigned your own keyboard shortcuts in VS Code.
- Select project, interpreter and environment independently, including nested projects in one workspace.
- Validate drafts, preview generated source as read-only native documents, and explicitly generate the full saved project.
- Open the Databricks bundle and hand off deployment to the official Databricks extension.

Preview is a source rendering aid. It does not represent bundle synchronisation, monitoring finalisation, sandbox generation or wheel packaging. It runs against an isolated project mirror and includes supported unsaved source documents. A preview expires when source, environment or interpreter changes.

Large refreshes remain cancellable and retain their previous graph with an explicit loading or failure state. Version 0.1.1 was checked against the public performance example with 4,017 flowgroups and 18,766 actions: the complete bridge response is 29.47 MB, within the fixed 32 MiB decoded-response budget of the Python bridge. This is not an unlimited project-size guarantee; an over-budget response fails explicitly without dropping graph members. Full inspection of that example took approximately 27 seconds end to end in the measured Linux ARM64 environment. External dataset notices are collapsed by default and graph rendering is limited to the visible viewport.

Full generation saves project documents after one explicit confirmation, replaces `generated/<environment>` and synchronises an enabled bundle. Filtered generation is deliberately unavailable because the core commit phase replaces an entire environment directory. Cancellation stops the process tree; generation itself is not transactional, so cancelled output should be regenerated before use. Configured test actions are validated; emitting their generated hooks is controlled by `lhp.includeTestsInGeneration`, matching the CLI's opt-in flag.

No remote execution, Databricks credentials, telemetry service, embedded editor or separate form save store is included. Workspace trust is required for Python execution and edits. Existing VS Code YAML functionality remains provided by Red Hat.

## Develop and verify

Use Node.js 22.12+ and Python 3.11+. Install the pinned core build into an isolated Python environment, then set `LHP_TEST_PYTHON` to its executable.

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
npm run test:bridge
npm run test:extension
npm run audit:production
npm run package
```

On headless Linux, use `xvfb-run -a npm run test:extension`. The runner downloads VS Code 1.106.0 and the official Red Hat YAML 1.24.0 release VSIX with a pinned SHA256, then uses isolated test settings and extensions. It never touches your installed VS Code profile. Real adapter tests require `LHP_TEST_PYTHON`; CI fails if it is missing or incompatible. Existing core E2E fixtures and baselines are not modified.

The [0.1.2 desktop build](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725124804) passed on Linux, macOS and Windows, including 48 unit/React/adapter tests, six Python bridge tests and real VS Code integration on each platform. Native sidebar tests cover source navigation, cached view expansion and startup selection. Exact artifact identity and source revision are recorded in [TODO.md](TODO.md).

`npm run package` creates `.tmp/lhp-vscode-0.1.2.vsix` and audits its contents. Only bundled host/webview JavaScript, CSS, the Python adapter, media and notices belong in the VSIX. Python/LHP itself is installed separately. Development dependencies, tests, project files and local paths must not be shipped.

See [PLAN.md](PLAN.md), [TODO.md](TODO.md), [architecture](docs/ARCHITECTURE.md) and [research](docs/RESEARCH.md). Apache-2.0; upstream and bundled dependency notices are retained.
