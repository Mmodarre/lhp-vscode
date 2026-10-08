# Lakehouse Plumber in VS Code

The native sidebar and designer share one selected project. The designer offers a project pipeline map, flowgroup and action graphs, and on-demand table/sink lineage. YAML and related SQL, Python, schema, and expectations files open in native VS Code editors. Your project files remain the source of truth.

Extension **0.2.0** runs in local desktop VS Code with a local Python 3.11 or newer interpreter. Download the [verified 0.2.0 VSIX](https://github.com/Mmodarre/lhp-vscode/actions/runs/37736437280/artifacts/11532285880) or build from source; [delivery evidence](../TODO.md) records its checksum and successful desktop matrix. Open a local folder; trust is required for Python execution and edits, while contained source browsing remains available without it. The [Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) supplies YAML schema support and is an extension dependency. The Python environment must contain the reviewed **LHP editor integration commit from the 0.9.3 development line**. That Git build currently reports package metadata **0.9.2**; the extension checks for the required editor APIs, so this version label alone does not indicate a wrong installation. Standard published PyPI 0.9.2 lacks those APIs.

## Open an existing project

1. Open the project folder, or a parent workspace folder, containing `lhp.yaml`. If several LHP projects exist in the workspace, use **LHP: Select Project** or the **Project** row in Configuration.
2. Choose **Lakehouse Plumber** in the Activity Bar to open the five native views. Configuration identifies the active project, environment, Python/LHP runtime and pipeline configuration. You can also run **LHP: Open Pipeline Designer** from the Command Palette. The graph will load when a compatible Python runtime is available.
3. If the runtime notice appears, use **LHP: Select Python Interpreter**. The picker offers a previously saved project interpreter, `lhp.pythonPath`, an existing project `.venv`, the Python extension selection, and Python on your `PATH`. It checks compatibility before saving the choice for this project.
4. If none is compatible, run **LHP: Set Up Python Environment**. Choose a Python 3.11+ base interpreter and a reviewed integration source. The installer creates a `.venv` in the project by default. A pinned reviewed Git build is offered only when this extension version includes its reviewed commit; otherwise choose a compatible local wheel or source checkout. Installation uses that selected environment, not a global `pip install`.

An existing `.venv` is never silently overwritten. You can use a compatible one, explicitly install or repair LHP in it, or create an environment in another folder. If creation or installation stops midway, choose **Retry setup** or **Choose another folder** in the error prompt. A partial folder with no Python executable is kept intact; choose a new location rather than deleting files by hand. If setup fails, the prompt provides a short cause category, such as certificate, network, Git, pip, permissions, or Python compatibility. Private installer output is not shown in the designer.

The interpreter chosen for a project is saved per project. You can also configure `lhp.pythonPath` for a workspace folder. A project `.venv` is detected automatically when no saved project choice or setting takes precedence.

## Navigate the five native views

The exact monochrome LHP mark in the Activity Bar opens **Configuration**, **Pipelines**, **Resources**, **Data** and **Generated Output**. The designer header uses the full-colour mark. These are native VS Code views: your editor theme, focus, keyboard and selection settings continue to apply. The first three start shallow; Data and Generated Output start collapsed. Expand and resize them as needed. View state is remembered per project, and inactive projects do not trigger a Python scan.

**Configuration** has five rows. Their selection controls and source controls serve different purposes:

| Row                    | Select or open                                             | Source and settings                                                                                          |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Project                | Choose the active LHP project.                             | Open `lhp.yaml` or reveal the project folder.                                                                |
| Environment            | Choose the active environment.                             | Open its local substitution source separately.                                                               |
| Python / LHP           | Choose a compatible interpreter.                           | The row shows runtime status; it is not a project source file.                                               |
| Active pipeline config | Open the selected config; if none is selected, choose one. | Use the change-config control to choose another file or LHP defaults.                                        |
| Settings               | Expand the row.                                            | Open LHP extension settings or indexed project, environment, job, bundle and monitoring configuration files. |

An existing project without an explicit pipeline config uses LHP defaults; a new bundle project selects the config created by its guide.

**Pipelines** lists the current semantic graph. Click a pipeline for its flowgroup graph, a flowgroup for its action graph, and an action for its precise YAML document and location. Related SQL, Python, schema, expectations and configuration leaves open their native files. **Open Source** on a flowgroup opens its invocation YAML. Template and blueprint actions distinguish shared definition from instance source. Generated monitoring nodes open their controlling configuration; they do not invent an editable action document.

**Resources** groups Templates, Blueprints, Presets, Schemas & transforms, Expectations, SQL and Python. It uses an independent physical inventory, so malformed YAML and an unavailable Python runtime do not hide your source files. Registered definitions and declared references enrich that inventory when available. **Find Resource** searches names and project-relative paths; **Find Consumers** lists known static source references, with a stale notice when the semantic graph is old. Files outside conventional folders can be found by path; their resource classification depends on content and the LHP catalogue. Bundle job templates are configuration, not flow templates.

**Data** loads canonical table/sink dependencies on demand. Select a produced table, sink or external input to inspect lineage and available producer/consumer source links. External input means an upstream dataset read by this project, not a remote catalogue query. The graph is tied to the current project, environment and source revision; edits mark it stale. No rows, credentials or remote datasets are fetched.

**Generated Output** contains files already on disk, including source, wheels and bundle artifacts. It never contains ephemeral previews. After successful source generation, **Find Authoring Source** is available when an exact pipeline/flowgroup mapping was recorded. Wheel or aggregate outputs do not acquire guessed source links. **Compare with Preview** is offered only for source output in the active environment; run Preview first. The comparison opens the persisted file and the expiring draft preview in a native diff editor.

View-title, overflow and item menus expose refresh, validation, preview, full generation, creation and Databricks handoff. The Pipelines **+** menu offers First flowgroup, Files to bronze, Template instance and Blueprint instance. Help and Get Started open documentation/walkthroughs without permanently filling the healthy workspace with onboarding cards. No default global keyboard bindings are imposed; assign your own to the LHP commands if desired.

## Get YAML help in the native editor

The required **YAML by Red Hat** extension provides syntax and runtime-matched schema completion. LHP scopes associations to recognised project files, including configured paths, multi-document authoring and blueprint instances. It does not associate every workspace YAML file. Bundle templates, job config and flow templates retain distinct roles.

Use **Trigger Suggest** for valid keys and enum values, installed-catalogue load/transform/write/test action snippets, template/blueprint/preset names, declared parameter keys, dataset references, source file paths and selected-environment substitution names. LHP reads YAML cursor structure, including quoted values and block-list entries, rather than treating text inside comments as a key. Hover fields or parameters for help; **Go to Definition** opens exact source addresses. Repeated names can have multiple explicit destinations, so check their pipeline and source labels.

Completion uses cached physical/catalogue/semantic state; it does not run Python per keystroke. Catalogue/schema help requires a compatible runtime, while native YAML editing and physical resource navigation remain available during setup. Custom assists skip files over 2 MiB or contexts that cannot be parsed reliably. The narrow `./known-file` quick fix is offered only when a unique known contained file is identifiable and checks the document version before applying. It does not auto-create datasets, choose ambiguous names, or rewrite a YAML document wholesale. Canonical **Validate Project** remains the authoritative LHP check and reports issues in Problems.

## Inspect resources without generating files

Use a resource's inspection command to open a read-only native document. Templates support **inspect**, **expanded** and **resolved** stages with sample parameters; they use the current template draft and saved dependencies. Pipeline/job configuration offers a target selector when the public API reports multiple targets. Configuration, preset and substitution inspection uses saved files and labels that boundary explicitly.

Substitution inspection shows local resolved values and raw mappings, including any sensitive literals you stored in that YAML. It does not look up Databricks secrets. Token completion/navigation deals in names and source locations. Inspection documents expire on context/source changes and are bounded in retained count and size. None of these views is a deployable generated artifact.

## Create a new project and the first bronze flowgroup

1. Run **LHP: Create Project**, or choose **Initialize project** in an empty designer. In Restricted Mode, choose **Manage Workspace Trust**, review the folder and grant trust if appropriate, then run **LHP: Create Project** again. Opening trust management does not continue the pending command. Dismissing the prompt keeps Python execution and project writes blocked. Select a compatible interpreter if prompted.
2. Choose a new folder name inside a selected parent, or choose an existing **empty** folder. Choose **Blank starter project** or **TPC-H sample project**, then decide whether to include Databricks bundle scaffolding. The creator refuses a nonempty target; it does not replace existing project files. If you include the bundle, enter the default Databricks catalog and schema when prompted. The extension creates `config/pipeline_config.yaml` with those defaults and selects it for this new project so full generation can include bundle resources. You can edit this native YAML later for individual pipelines or environments.
3. Open the designer and select the intended environment, usually `dev`, in the top toolbar.
4. Choose **Files → bronze**. For example, enter flowgroup `orders_bronze`, pipeline `bronze_load`, landing path `/Volumes/main/landing/orders/`, format `CSV`, and bronze table `main.bronze.orders`. Replace the example landing path with a location your Databricks workspace can read. The table must be fully qualified as `catalog.schema.table`. You can introduce `${...}` substitutions later after defining them in the project environment files. The guide supports CSV, JSON, Parquet, Avro, ORC, and Text. The landing path names data that Auto Loader reads; it is not a project source file to edit.
5. Choose **Create flowgroup**. LHP creates a new YAML draft with a streaming file-load action and a streaming-table write action. The new file opens beside the designer. Review the source path, variables, and target table for your project. Save the YAML, choose **Validate**, and inspect any issues in VS Code's **Problems** panel.
6. Choose **Preview output** to inspect read-only generated source for the selected environment. Once the YAML and environment are correct, choose **Generate full project…**. The confirmation names the environment and warns that its generated output is replaced. The extension saves open project documents before the full generation call.

Creating the flowgroup does not ingest data or run a Databricks pipeline. It creates project configuration that must be validated, generated, deployed, and run in the appropriate environment.

For an empty authoring document, choose **First flowgroup** and supply a name, pipeline and new project-relative YAML path. The native draft starts with `actions: []` and the designer can add actions. Existing targets are never overwritten. If your path is outside the project's include patterns, the extension keeps the draft open and directs you to `lhp.yaml` discovery configuration instead of claiming it entered the graph.

## Navigate and edit the graphs

Select a pipeline in the native Pipelines view to see its flowgroup graph. Its arrows represent dependencies reported by LHP, with dataset labels where available. A **single click** on a flowgroup node enters its action graph; the pipeline inspector also offers **Open action graph**. Action arrows come from LHP canonical dependency analysis, including supported SQL/Python reads. A **single click** on an action node opens its YAML location in a native editor beside the graph and shows its inspector. The graph cards are keyboard focusable: use **Tab** to reach one and **Enter** or **Space** to select it.

In the action inspector, use **Open action YAML beside graph** or a referenced-file link to edit the real project source. File links distinguish SQL, Python, schema, expectations, and configuration sources; missing files are marked. The form shows fields defined in LHP's editor catalogue. **Apply to YAML** edits the native document, so VS Code undo and redo apply. **Show complete mapping** exposes an advanced JSON view for fields without a guided control while preserving unknown keys. You can add, duplicate, configure, connect, disconnect, and delete editable direct actions. Connections use a named output view or dataset; a derived or inherited edge may be read only.

The top bar reports unsaved documents. If the current YAML cannot be parsed, the designer labels the graph **Stale graph** and pauses graph mutations. Fix the YAML in the native editor or use **Undo**, then refresh. If another edit changes the same action or instance while a form has a local draft, the inspector keeps that draft and asks you to review the latest source before applying more changes. The host checks document versions and project revision before a graph edit; a rejected stale edit needs a refresh and review.

## Templates and blueprints

Choose **Template instance** or **Blueprint instance** from the native Pipelines **+** menu or the designer Create menu. Select a definition from the current project catalogue and a **new project-relative YAML path**, then fill its declared parameters. Template instances also need a flowgroup name and pipeline; a blueprint invocation is identified by its new YAML file. **Show advanced parameters** accepts a complete JSON parameter object for values without a guided field. Existing target files are not replaced.

An instance is a reference to a reusable definition. The graph labels inherited actions as read only and links to both the definition and instance YAML where available. Edit shared action logic in the definition source, or edit instance parameters in the flowgroup inspector when that invocation supports it. The definition can affect other consumers, so review them before changing shared logic. Direct actions can be changed in the action inspector; expanded inherited actions cannot be edited as if they were private copies.

## Validate, preview, generate, and hand off

**Validate** asks LHP to check the current project and sends reported issues to the Problems panel. **Preview output** uses the current editor drafts and displays read-only generated source files. It is explicitly **source-only**: it does not include every final artifact, bundle synchronisation, monitoring finalisation, or sandbox generation, and wheel-mode projects are unsupported in preview. A changed document makes an earlier preview stale; run preview again.

**Generate full project…** is an explicit, confirmed operation. It saves open project documents first and runs LHP for the selected environment. Full generation replaces `generated/<environment>` output and updates enabled bundle resources. It is not a Databricks deploy or run. Use **LHP: Open Databricks Bundle** to open `databricks.yml` beside the designer. If the Databricks extension is not installed, VS Code opens its extension search; then use your Databricks extension and project workflow to choose a workspace and target, validate, deploy, and run.

You can cancel a running LHP operation from the designer or the notification progress UI. A cancelled operation should be reviewed before retrying; generated files may have been touched by an interrupted full generation.

## If the view does not match your source

- Check the selected project and environment at the top of the designer, then choose **Refresh**. Multiple projects in one workspace have separate interpreter and environment selections.
- Resolve syntax errors in native YAML first. A stale graph shows the last valid project structure so you can navigate while repairing source; graph edits remain paused.
- If actions or definitions are absent, confirm they are in the project discovered from `lhp.yaml` and that the selected Python reports the compatible editor integration APIs.
- If preview and full generation differ, treat full generation as authoritative for deployable artifacts. Preview deliberately has the source-only limits described above.
- If an edit reports a version or context conflict, refresh, inspect the current YAML, and reapply the intended change. VS Code's native editor and undo history remain authoritative.

## Large projects and browsing limits

Physical discovery is bounded to 50,000 entries, excludes environments/caches and symlinks, and discloses incomplete results. YAML content classification is limited to 512 KiB per file; larger files still appear by path. Nested LHP roots keep independent event, draft and interpreter ownership. Native Explorer remains available for excluded or additional files.

A full semantic response is limited to 32 MiB decoded data. The extension fails explicitly instead of truncating graph nodes or edges. Projects above 500 flowgroups do not rescan the entire semantic graph after every edit; use Refresh when ready. Data inspection has its own 50,000-file/256 MiB authoring-mirror budget. Progress is cancellable, and source, runtime and transport failures have separate states. Preview is never a persisted output or a promise of bundle, monitoring, sandbox or wheel parity.
