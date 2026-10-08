# Lakehouse Plumber for VS Code

Author Lakehouse Plumber pipelines in native YAML and a synchronised graph designer. Guided forms use the same VS Code documents and undo history as your editor.

This first integration release targets desktop VS Code on macOS, Windows and Linux. Distribution is a downloadable VSIX; it is not published to the Marketplace.

## Install

1. Download `lhp-vscode-0.1.1.vsix` from the build artifact supplied with the implementation PR, or build it below.
2. In VS Code, run **Extensions: Install from VSIX…**. Install **YAML by Red Hat** if VS Code requests the dependency.
3. Open a trusted local folder and run **LHP: Open Pipeline Designer**.
4. Select an existing compatible Python environment or use **Set Up Python Environment**. Python 3.11 or newer is required.

The extension requires the unreleased LHP 0.9.3 editor integration build at commit [`98d285ab8a7606867abb5708f2715ebe31a9befc`](https://github.com/Mmodarre/Lakehouse_Plumber/commit/98d285ab8a7606867abb5708f2715ebe31a9befc). Its distribution metadata still reports `0.9.2`; compatibility checks verify the public editor API capabilities. The ordinary PyPI 0.9.2 package does not contain those APIs. Guided setup installs the exact integration commit in a chosen virtual environment. Git is required for that installation; a compatible local wheel or source checkout can also be selected.

[Read the user guide](docs/USER_GUIDE.md) for the complete first-pipeline and existing-project workflows.

## Authoring

- Browse pipelines, drill into flowgroups and inspect canonical LHP action dependencies.
- Add, configure, duplicate and delete actions. Connect or disconnect directly declared dataset inputs; code-derived edges open their SQL/Python source for editing.
- Edit YAML beside guided forms. Changes use version-checked WorkspaceEdits, preserve unchanged mapping comments, and participate in native undo/redo.
- Create files-to-bronze ingestion and template/blueprint instances. Shared definitions and generated monitoring actions show their actual editing scope.
- Open referenced SQL, Python, schemas, expectations and configuration in native editors.
- Use installed-runtime schemas, action help, semantic completions, definitions and Problems diagnostics.
- Select project, interpreter and environment independently, including nested projects in one workspace.
- Validate drafts, preview generated source as read-only native documents, and explicitly generate the full saved project.
- Open the Databricks bundle and hand off deployment to the official Databricks extension.

Preview is a source rendering aid. It does not represent bundle synchronisation, monitoring finalisation, sandbox generation or wheel packaging. It runs against an isolated project mirror and includes supported unsaved source documents. A preview expires when source, environment or interpreter changes.

Large refreshes remain cancellable and retain their previous graph with an explicit loading or failure state. Version 0.1.1 was checked against the public performance example with 4,017 flowgroups and 18,766 actions: the complete bridge response is 29.47 MB, within the fixed 32 MiB decoded-response budget. This is not an unlimited project-size guarantee; an over-budget response fails explicitly without dropping graph members. Full inspection of that example took approximately 145 seconds end to end in the measured Linux ARM64 environment. External dataset notices are collapsed by default and graph rendering is limited to the visible viewport.

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

The [verified desktop build](https://github.com/Mmodarre/lhp-vscode/actions/runs/37713497951) passes on Linux, macOS and Windows, including 31 unit/React/adapter tests, three real Python bridge tests and real VS Code integration on each platform. [TODO.md](TODO.md) records the delivered artifact checksum and exact tested revision.

`npm run package` creates `.tmp/lhp-vscode-0.1.1.vsix` and audits its contents. Only bundled host/webview JavaScript, CSS, the Python adapter, media and notices belong in the VSIX. Python/LHP itself is installed separately. Development dependencies, tests, project files and local paths must not be shipped.

See [PLAN.md](PLAN.md), [TODO.md](TODO.md), [architecture](docs/ARCHITECTURE.md) and [research](docs/RESEARCH.md). Apache-2.0; upstream and bundled dependency notices are retained.
