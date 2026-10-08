# Lakehouse Plumber in VS Code

The designer shows the same project as two connected graphs: flowgroups inside a pipeline, then actions inside a flowgroup. YAML and related SQL, Python, schema, and expectations files open in native VS Code editors. Your project files remain the source of truth.

Extension **0.1.2** runs in local desktop VS Code with a local Python 3.11 or newer interpreter. Download the [verified 0.1.2 VSIX artifact](https://github.com/Mmodarre/lhp-vscode/actions/runs/37725124804/artifacts/11526939315), or build from source. Open a trusted folder. The [Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) supplies YAML schema support and is an extension dependency. The Python environment must contain the reviewed **LHP editor integration commit from the 0.9.3 development line**. That Git build currently reports package metadata **0.9.2**; the extension checks for the required editor APIs, so this version label alone does not indicate a wrong installation. Standard published PyPI 0.9.2 lacks those APIs.

## Open an existing project

1. Open the project folder, or a parent workspace folder, containing `lhp.yaml`. If several LHP projects exist in the workspace, use **LHP: Select Project** or the project selector in the designer.
2. Choose **Lakehouse Plumber** in the Activity Bar to open the native **Projects** tree. You can also run **LHP: Open Pipeline Designer** from the Command Palette. The graph will load when a compatible Python runtime is available.
3. If the runtime notice appears, use **LHP: Select Python Interpreter**. The picker offers a previously saved project interpreter, `lhp.pythonPath`, an existing project `.venv`, the Python extension selection, and Python on your `PATH`. It checks compatibility before saving the choice for this project.
4. If none is compatible, run **LHP: Set Up Python Environment**. Choose a Python 3.11+ base interpreter and a reviewed integration source. The installer creates a `.venv` in the project by default. A pinned reviewed Git build is offered only when this extension version includes its reviewed commit; otherwise choose a compatible local wheel or source checkout. Installation uses that selected environment, not a global `pip install`.

An existing `.venv` is never silently overwritten. You can use a compatible one, explicitly install or repair LHP in it, or create an environment in another folder. If creation or installation stops midway, choose **Retry setup** or **Choose another folder** in the error prompt. A partial folder with no Python executable is kept intact; choose a new location rather than deleting files by hand. If setup fails, the prompt provides a short cause category, such as certificate, network, Git, pip, permissions, or Python compatibility. Private installer output is not shown in the designer.

The interpreter chosen for a project is saved per project. You can also configure `lhp.pythonPath` for a workspace folder. A project `.venv` is detected automatically when no saved project choice or setting takes precedence.

## Navigate with the Project tree

The **Lakehouse Plumber** Activity Bar icon opens one native **Projects** tree. Expand the active project, then a pipeline, flowgroup, and action to see its referenced SQL, Python, schema, expectations, configuration, or shared-definition files when LHP reports them. Only expanded levels are populated. Other workspace projects stay collapsed until you select one, so opening the tree does not load their Python runtime.

Select a pipeline to open its graph in the existing designer. Select a flowgroup, action, or related file to open its source in a native editor. For a flowgroup or action, use its **Open in Designer** context action to focus that graph and inspector; the source remains the same VS Code document. A missing related file is marked and cannot be opened until you create it. Shared template and blueprint actions link to their definition and instance files rather than pretending the expanded action is directly editable.

The tree title offers **Open Pipeline Designer**, **Refresh Project**, and **Cancel Current Operation** when applicable. Its overflow menu includes validation, preview, full generation, environment selection, Python setup, project creation, and Databricks handoff. Tree items have context actions for source and designer navigation. These are VS Code command shortcuts, not new default keyboard bindings; use **Keyboard Shortcuts** to assign keys to the existing `LHP` commands if desired. When no project is found, the tree offers create/open links. Loading, unavailable runtime, failed refresh and stale-graph notices appear in the view without replacing the last valid project structure.

## Get YAML help in the native editor

Install the required **YAML by Red Hat** extension and open a YAML file inside an LHP project. LHP associates runtime-provided schemas with `lhp.yaml`, pipeline/flowgroup files, reusable definitions, substitutions, schema files, and known configuration files. Use VS Code's **Trigger Suggest** command for schema-backed keys and values; hover a supported action field for its description, and use **Go to Definition** on recognised project names or action outputs. Project validation also reports LHP issues in the **Problems** panel. These features work on the native YAML document, including unsaved edits where the LHP runtime supports them.

The LHP-specific value suggestions currently inspect the text before the cursor on one line, and output-name suggestions cover the loaded project. They can be broad when names repeat or when text resembles a YAML key inside a comment or string. Go to Definition can likewise show several same-named outputs. Check the target and run **Validate Project** for authoritative LHP feedback. Runtime-derived schemas and catalogue help become available after a compatible Python runtime loads the project; the base YAML editor remains usable while that setup is incomplete.

## Create a new project and the first bronze flowgroup

1. Run **LHP: Create Project**, or choose **Initialize project** in an empty designer. Select a compatible interpreter if prompted.
2. Choose a new folder name inside a selected parent, or choose an existing **empty** folder. Then choose whether to include Databricks bundle scaffolding. The creator refuses a nonempty target; it does not replace existing project files. If you include the bundle, enter the default Databricks catalog and schema when prompted. LHP's bootstrap supplies a `.tmpl` reference; the extension creates `config/pipeline_config.yaml` with those defaults and selects it for this new project so full generation can include bundle resources. You can edit this native YAML later for individual pipelines or environments.
3. Open the designer and select the intended environment, usually `dev`, in the top toolbar.
4. Choose **Files → bronze**. For example, enter flowgroup `orders_bronze`, pipeline `bronze_load`, landing path `/Volumes/main/landing/orders/`, format `CSV`, and bronze table `main.bronze.orders`. Replace the example landing path with a location your Databricks workspace can read. The table must be fully qualified as `catalog.schema.table`. You can introduce `${...}` substitutions later after defining them in the project environment files. The guide supports CSV, JSON, Parquet, Avro, ORC, and Text. The landing path names data that Auto Loader reads; it is not a project source file to edit.
5. Choose **Create flowgroup**. LHP creates a new YAML draft with a streaming file-load action and a streaming-table write action. The new file opens beside the designer. Review the source path, variables, and target table for your project. Save the YAML, choose **Validate**, and inspect any issues in VS Code's **Problems** panel.
6. Choose **Preview output** to inspect read-only generated source for the selected environment. Once the YAML and environment are correct, choose **Generate full project…**. The confirmation names the environment and warns that its generated output is replaced. The extension saves open project documents before the full generation call.

Creating the flowgroup does not ingest data or run a Databricks pipeline. It creates project configuration that must be validated, generated, deployed, and run in the appropriate environment.

## Navigate and edit the graphs

Select a pipeline in the left tree to see its flowgroup graph. Its arrows represent dependencies reported by LHP, with dataset labels where available. A **single click** on a flowgroup node enters its action graph; the pipeline inspector also offers **Open action graph**. Action arrows represent source and target view relationships. A **single click** on an action node opens its YAML location in a native editor beside the graph and shows its inspector. The graph cards are keyboard focusable: use **Tab** to reach one and **Enter** or **Space** to select it.

In the action inspector, use **Open action YAML beside graph** or a referenced-file link to edit the real project source. File links distinguish SQL, Python, schema, expectations, and configuration sources; missing files are marked. The form shows fields defined in LHP's editor catalogue. **Apply to YAML** edits the native document, so VS Code undo and redo apply. **Show complete mapping** exposes an advanced JSON view for fields without a guided control while preserving unknown keys. You can add, duplicate, configure, connect, disconnect, and delete editable direct actions. Connections use a named output view or dataset; a derived or inherited edge may be read only.

The top bar reports unsaved documents. If the current YAML cannot be parsed, the designer labels the graph **Stale graph** and pauses graph mutations. Fix the YAML in the native editor or use **Undo**, then refresh. If another edit changes the same action or instance while a form has a local draft, the inspector keeps that draft and asks you to review the latest source before applying more changes. The host checks document versions and project revision before a graph edit; a rejected stale edit needs a refresh and review.

## Templates and blueprints

Choose **Template instance** or **Blueprint instance** in the left sidebar. Select a definition from the current project catalogue and a **new project-relative YAML path**, then fill its declared parameters. Template instances also need a flowgroup name and pipeline; a blueprint invocation is identified by its new YAML file. **Show advanced parameters** accepts a complete JSON parameter object for values without a guided field. Existing target files are not replaced.

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
