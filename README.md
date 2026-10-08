# Lakehouse Plumber for VS Code

Author Lakehouse Plumber pipelines in native YAML and a synchronised graph designer. Guided forms use the same VS Code documents and undo history as your editor.

This integration targets desktop VS Code on macOS, Windows and Linux. Distribution is a VSIX; it is not published to the Marketplace. Version 0.2.0 adds five native views, resource browsing, project/data graphs, read-only inspections and richer YAML assistance. Desktop verification passes on all three platforms; [TODO.md](TODO.md) records the delivered artifact and checksum.

## Install

1. Download the [verified 0.2.0 VSIX artifact](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736437280/artifacts/11532285880) and extract `lhp-vscode-0.2.0.vsix`, or build it with `npm ci` and `npm run package`.
2. In VS Code, run **Extensions: Install from VSIX…**. Install **YAML by Red Hat** if VS Code requests the dependency.
3. Open a local folder. Choose the **Lakehouse Plumber** Activity Bar icon to browse the selected project. Contained source browsing works without Python or workspace trust; trust is required for execution and edits.
4. Select an existing compatible Python environment or use **Set Up Python Environment**. Python 3.11 or newer is required.

In Restricted Mode, **Create Project**, **Select Python Interpreter** and **Set Up Python Environment** offer **Manage Workspace Trust**. Review the folder there and grant trust only if you trust its contents, then run the LHP command again. Opening the trust editor or dismissing the prompt ends the current command without running Python or writing project files. Version 0.2.1 adds this recovery path for newly opened folders.

The extension requires the unreleased LHP 0.9.3 editor integration build at commit [`98d285ab8a7606867abb5708f2715ebe31a9befc`](https://github.com/Mmodarre/Lakehouse_Plumber/commit/98d285ab8a7606867abb5708f2715ebe31a9befc). Its distribution metadata still reports `0.9.2`; compatibility checks verify the public editor API capabilities. The ordinary PyPI 0.9.2 package does not contain those APIs. Guided setup installs the exact integration commit in a chosen virtual environment. Git is required for that installation; a compatible local wheel or source checkout can also be selected.

[Read the user guide](docs/USER_GUIDE.md) for the complete first-pipeline and existing-project workflows.

## Authoring

- Use five native views: **Configuration**, **Pipelines**, **Resources**, **Data** and **Generated Output**. The Activity Bar uses the exact monochrome LHP mark and the designer header uses its full-colour mark; neither changes your VS Code theme. Select one project; expand only the resources you need. Pipeline and flowgroup clicks open their graphs, while action and file clicks open native source.
- Browse physical resources even with invalid YAML or an unavailable runtime. Find resource paths and known consumers without launching Python.
- Explore canonical pipeline dependencies and on-demand table/sink lineage. Inspect template drafts, saved pipeline/job settings, effective presets and local substitutions in expiring read-only documents.
- Add, configure, duplicate and delete actions. Connect or disconnect directly declared dataset inputs; code-derived edges open their SQL/Python source for editing.
- Edit YAML beside guided forms. Changes use version-checked WorkspaceEdits, preserve unchanged mapping comments, and participate in native undo/redo.
- Create an empty project or TPC-H sample, a first flowgroup, files-to-bronze ingestion and template/blueprint instances. Shared definitions and generated monitoring actions show their actual editing scope.
- Open referenced SQL, Python, schemas, expectations and configuration in native editors.
- Use runtime-matched YAML schemas, context-aware reference/parameter/file/token suggestions, catalogue-derived action snippets, hover help, definitions and a version-checked path quick fix. Red Hat YAML supplies syntax/schema support; LHP adds cached project context without Python calls on each keystroke.
- Use view-title and context-menu shortcuts for refresh, validation, preview, generation, environment and Python setup. Existing LHP commands can also be assigned your own keyboard shortcuts in VS Code.
- Select project, interpreter and environment independently, including nested projects in one workspace.
- Validate drafts, preview generated source as read-only native documents, and explicitly generate the full saved project.
- Browse persisted source, wheels and bundle artifacts; compare eligible current-environment generated source with an expiring draft preview. Successful source generation records exact flowgroup authoring links.
- Open the Databricks bundle and hand off deployment to the official Databricks extension.

Preview is a source rendering aid. It does not represent bundle synchronisation, monitoring finalisation, sandbox generation or wheel packaging. It runs against an isolated project mirror and includes supported unsaved source documents. A preview expires when source, environment or interpreter changes.

Large refreshes remain cancellable and retain their previous graph with an explicit loading or failure state. Version 0.2.0 was checked against the public performance example with 4,017 flowgroups and 18,766 actions, preserving every canonical action and dependency. The Python bridge retains a fixed 32 MiB decoded-response budget; an over-budget response fails explicitly without dropping graph members. The measured native refresh took 20.119 seconds in a shared Linux ARM64 environment, not a fixed latency guarantee. External dataset notices are collapsed by default and graph rendering is limited to the visible viewport. In large projects (over 500 flowgroups), edits update physical resources and mark the semantic graph stale; refresh that graph explicitly when ready. Physical discovery has a disclosed 50,000-entry budget, YAML classification a 512 KiB-per-file budget, and custom YAML assistance a 2 MiB-per-document budget. Read-only Data inspection uses a separate authoring-file mirror limited to 50,000 files/256 MiB; it does not append source bodies to the graph snapshot.

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

The [0.2.0 push build](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736437280) and [PR build](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736442314) both passed on Linux, macOS and Windows, including 84 unit/React/adapter tests without skips, ten Python bridge tests, real VS Code integration and the production audit with zero vulnerabilities. Native checks cover five-view navigation, YAML help, inspectors, source edits, generated preview comparison and project isolation. Exact artifact identity and runtime revision are recorded in [TODO.md](TODO.md).

`npm run package` creates `.tmp/lhp-vscode-0.2.1.vsix` and audits its contents. Only bundled host/webview JavaScript, CSS, the Python adapter, media and notices belong in the VSIX. Python/LHP itself is installed separately. Development dependencies, tests, project files and local paths must not be shipped.

See [PLAN.md](PLAN.md), [TODO.md](TODO.md), [architecture](docs/ARCHITECTURE.md) and [research](docs/RESEARCH.md). Apache-2.0; upstream and bundled dependency notices are retained.
