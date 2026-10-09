#!/usr/bin/env python3
"""One-request NDJSON adapter over the public Lakehouse Plumber API.

No CLI parsing, private-module imports or network listeners. The host owns
workspace trust and interpreter selection; this adapter validates its boundary.
"""

from __future__ import annotations

import contextlib
from dataclasses import fields, is_dataclass
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import re
import sys
from typing import Any

PROTOCOL_VERSION = 2
MAX_REQUEST = 16 * 1024 * 1024
OPERATIONS = {
    "health",
    "snapshot",
    "catalog",
    "validate",
    "preview",
    "generate",
    "init",
    "scaffold",
    "inspect",
    "data",
}
REQUIRED_APIS = (
    "inspect_editor_project",
    "inspect_editor_document",
    "preview_editor_project",
    "validate_editor_project",
    "editor_catalog",
    "EditorDocumentOverlay",
    "scaffold_editor_instance",
    "scaffold_editor_bronze",
    "preview_template",
    "preview_configuration",
)


class RequestError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def validate_request(value: Any) -> dict[str, Any]:
    """Validate external JSON; Any is used only for untrusted JSON values."""
    if not isinstance(value, dict) or value.get("protocolVersion") != PROTOCOL_VERSION:
        raise RequestError("PROTOCOL_VERSION", "Unsupported bridge protocol version.")
    if (
        not isinstance(value.get("id"), str)
        or not value["id"]
        or len(value["id"]) > 200
    ):
        raise RequestError("REQUEST_ID", "A bounded request ID is required.")
    if value.get("operation") not in OPERATIONS:
        raise RequestError("OPERATION", "Unsupported bridge operation.")
    env = value.get("environment", "dev")
    if (
        not isinstance(env, str)
        or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", env)
        or ".." in env
    ):
        raise RequestError("ENVIRONMENT", "Invalid environment name.")
    root = value.get("projectRoot")
    if value["operation"] != "health" and (
        not isinstance(root, str) or not Path(root).is_absolute()
    ):
        raise RequestError("PROJECT_ROOT", "An absolute project root is required.")
    if value.get("options") is not None and not isinstance(value["options"], dict):
        raise RequestError("OPTIONS", "Options must be a JSON object.")
    options = value.get("options") or {}
    for key in ("sandboxEnabled", "includeTests"):
        if key in options and not isinstance(options[key], bool):
            raise RequestError("OPTIONS", f"{key} must be a boolean.")
    documents = value.get("documents") or []
    if not isinstance(documents, list) or len(documents) > 1000:
        raise RequestError("DOCUMENTS", "Invalid document overlay collection.")
    seen: set[str] = set()
    for document in documents:
        if not isinstance(document, dict) or not isinstance(document.get("text"), str):
            raise RequestError("DOCUMENT", "Each document requires text.")
        filename = document.get("path")
        if (
            not isinstance(filename, str)
            or not filename
            or "\\" in filename
            or Path(filename).is_absolute()
            or any(part in {"", ".", ".."} for part in filename.split("/"))
        ):
            raise RequestError(
                "DOCUMENT_PATH", "Overlay paths must stay inside the project."
            )
        if filename in seen:
            raise RequestError("DOCUMENT_PATH", "Duplicate document overlay.")
        seen.add(filename)
        if filename.startswith('.lhp/') and filename != '.lhp/profile.yaml':
            raise RequestError('DOCUMENT_PATH', 'Only .lhp/profile.yaml may be inspected.')
        if filename == '.lhp/profile.yaml' and len(document['text'].encode('utf-8')) > 2 * 1024 * 1024:
            raise RequestError('DOCUMENT_LIMIT', 'Sandbox profile draft exceeds 2 MiB.')
        if isinstance(root, str):
            resolved = (Path(root) / filename).resolve()
            if not resolved.is_relative_to(Path(root).resolve()):
                raise RequestError(
                    "DOCUMENT_PATH", "Overlay symlinks must stay inside the project."
                )
            if filename == '.lhp/profile.yaml' and (
                (Path(root) / '.lhp').is_symlink() or (Path(root) / filename).is_symlink()
            ):
                raise RequestError('DOCUMENT_PATH', 'Sandbox profile must not use symlinks.')
        version = document.get("version")
        if not isinstance(version, int) or isinstance(version, bool) or version < 0:
            raise RequestError("DOCUMENT_VERSION", "Invalid document version.")
    if value["operation"] == "generate" and documents:
        raise RequestError(
            "UNSAVED_GENERATION", "Save all project documents before full generation."
        )
    return value


def runtime_health() -> dict[str, Any]:
    result: dict[str, Any] = {
        "pythonVersion": platform.python_version(),
        "interpreter": sys.executable,
        "compatible": False,
        "capabilities": [],
    }
    try:
        result["lhpVersion"] = importlib.metadata.version("lakehouse-plumber")
    except importlib.metadata.PackageNotFoundError:
        result["message"] = (
            "Lakehouse Plumber is not installed in this Python environment. "
            "Select another interpreter or set up the reviewed editor integration build."
        )
        return result
    try:
        import lhp.api as api

        missing = [name for name in REQUIRED_APIS if not hasattr(api, name)]
        # release/V0.9.3 intentionally still has 0.9.2 distribution metadata.
        # Capability probes distinguish that integration build from PyPI 0.9.2.
        version = str(result["lhpVersion"])
        family = re.match(r"^0\.9\.(?:2|3)(?:$|[a-z.+-])", version) is not None
        result["compatible"] = family and not missing and sys.version_info >= (3, 11)
        result["capabilities"] = [name for name in REQUIRED_APIS if hasattr(api, name)]
        sandbox_editor = not missing and all(
            "sandbox" in inspect.signature(getattr(api, name)).parameters
            for name in ("inspect_editor_project", "validate_editor_project", "preview_editor_project")
        ) and "include_tests" in inspect.signature(api.preview_editor_project).parameters
        sandbox_editor = sandbox_editor and all(
            hasattr(api, name) and is_dataclass(getattr(api, name)) and required.issubset(
                {field.name for field in fields(getattr(api, name))}
            )
            for name, required in (
                ('EditorProjectView', {'sandbox_enabled', 'sandbox'}),
                ('SandboxScopeResult', {'profile_exists', 'namespace', 'patterns', 'resolved_pipelines', 'allowed_envs', 'error', 'strategy', 'table_pattern'}),
            )
        )
        if sandbox_editor:
            result["capabilities"].append("sandbox_editor")
        elif result["compatible"]:
            result["message"] = (
                "This interpreter supports ordinary editor operations. Sandbox drafts and accurate "
                "sandbox preview require the LHP core build reviewed for extension 0.3.0. "
                "Run LHP: Set Up Python Environment to upgrade."
            )
        if not result["compatible"]:
            result["message"] = (
                "Install the LHP 0.9.3 integration build with editor APIs. The standard 0.9.2 package does not provide them."
            )
    except (ImportError, importlib.metadata.PackageNotFoundError):
        result["message"] = (
            "Lakehouse Plumber is installed, but its editor API could not load. "
            "Repair this environment's dependencies or select another compatible interpreter."
        )
    return result


def dispatch(request: dict[str, Any], emit: Any) -> Any:
    """Route checked JSON to public APIs; Any models JSON/event callback values."""
    operation = request["operation"]
    health = runtime_health()
    if operation == "health":
        return health
    if not health["compatible"]:
        raise RequestError(
            "INCOMPATIBLE_RUNTIME", health.get("message", "Incompatible LHP runtime.")
        )
    import lhp.api as api

    root = Path(request.get("projectRoot", ".")).resolve()
    env = request.get("environment") or "dev"
    options = request.get("options") or {}
    sandbox = options.get("sandboxEnabled", False) is True
    sandbox_editor = "sandbox_editor" in health["capabilities"]
    if not sandbox_editor and (
        sandbox or any(d["path"] == ".lhp/profile.yaml" for d in request.get("documents") or [])
    ):
        raise RequestError("SANDBOX_RUNTIME_UPGRADE", health.get("message", "Upgrade the LHP editor core for sandbox support."))
    editor_options = {"sandbox": sandbox} if sandbox_editor else {}
    overlays = tuple(
        api.EditorDocumentOverlay(path=d["path"], text=d["text"], version=d["version"])
        for d in request.get("documents") or []
    )
    configuration = options.get("pipelineConfigPath") or None
    if configuration is not None:
        if not isinstance(configuration, str) or not (
            root / configuration
        ).resolve().is_relative_to(root):
            raise RequestError(
                "CONFIG_PATH", "Pipeline configuration must be inside the project."
            )
    if operation == "snapshot":
        return project_snapshot(
            api.inspect_editor_project(
                root, env=env, overlays=overlays, pipeline_config_path=configuration,
                **editor_options,
            ),
            api,
        )
    if operation == "catalog":
        return api.to_dict(api.editor_catalog(root))
    if operation == "inspect":
        from lhp_inspection import inspect_resource

        return inspect_resource(api, root, env, options, configuration)
    if operation == "data":
        from lhp_inspection import dataset_index

        return dataset_index(
            api,
            root,
            env,
            configuration,
            request.get("documents") or [],
            options.get("nestedProjectRoots") or [],
            sandbox=sandbox,
        )
    if operation == "validate":
        return consume(
            api.validate_editor_project(
                root,
                env=env,
                overlays=overlays,
                pipeline_config_path=configuration,
                include_tests=True,
                **editor_options,
            ),
            api,
            emit,
        )
    if operation == "preview":
        return consume(
            api.preview_editor_project(
                root, env=env, overlays=overlays, pipeline_config_path=configuration,
                **({**editor_options, "include_tests": options.get("includeTests", False) is True} if sandbox_editor else {}),
            ),
            api,
            emit,
        )
    if operation == "init":
        return api.to_dict(
            api.LakehousePlumberBootstrap().init_project(
                root,
                bundle=bool(options.get("bundle", True)),
                project_name=options.get("name"),
                sample_mode=options.get("sampleMode", False) is True,
                initialize_git=False,
            )
        )
    if operation == "scaffold":
        kind = options.get("kind")
        if kind in {"template", "blueprint"} and hasattr(
            api, "scaffold_editor_instance"
        ):
            return api.to_dict(
                api.scaffold_editor_instance(
                    root,
                    kind=kind,
                    flowgroup=options.get("name", ""),
                    pipeline=options.get("pipeline", ""),
                    reference=options.get("definition", ""),
                    parameters=options.get("parameters") or {},
                )
            )
        if kind == "bronze" and hasattr(api, "scaffold_editor_bronze"):
            return api.to_dict(
                api.scaffold_editor_bronze(
                    name=options.get("name", ""),
                    pipeline=options.get("pipeline", ""),
                    source_path=options.get("sourcePath", ""),
                    format=options.get("format", ""),
                    target=options.get("target", ""),
                )
            )
        raise RequestError(
            "UNSUPPORTED_SCAFFOLD",
            "This runtime does not support the requested guided scaffold.",
        )
    if operation == "generate":
        if sandbox:
            # Generation reads the saved profile directly rather than through
            # the inspection mirror, so apply its file boundary here too.
            from lhp_inspection import checked_profile_path

            checked_profile_path(root)
        facade = api.LakehousePlumberApplicationFacade.for_project(
            root,
            pipeline_config_path=str((root / configuration).resolve())
            if configuration
            else None,
            no_cache=True,
        )
        scope = api.to_dict(facade.sandbox.describe_scope(env=env)) if sandbox and sandbox_editor else None
        response = consume(
            facade.generate_pipelines(
                env=env,
                output_dir=root / "generated" / env,
                include_tests=options.get("includeTests", False) is True,
                bundle_enabled=api.should_enable_bundle_support(
                    root, cli_no_bundle=False
                ),
                pipeline_filter=None,
                sandbox=sandbox,
            ),
            api,
            emit,
        )
        # Authoring links are valid only for source-mode flowgroup files. Use
        # the public configuration resolver; unknown/wheel modes get no link.
        modes = {}
        for pipeline in response.get("pipeline_responses", {}):
            try:
                modes[pipeline] = (
                    api.preview_configuration(
                        root,
                        path=configuration,
                        kind="pipeline",
                        env=env,
                        target=pipeline,
                    )["values"]["packaging"]
                    if configuration
                    else "source"
                )
            except Exception:
                modes[pipeline] = "unknown"
        response["editor_packaging"] = modes
        response["sandbox_enabled"] = sandbox
        response["sandbox"] = scope
        response["environment"] = env
        return response
    raise RequestError("OPERATION", "Unsupported operation.")


def project_snapshot(view: Any, api: Any) -> dict[str, Any]:
    """Project public DTOs to the editor contract without dropping graph members.

    Resolved flowgroup bodies duplicate the per-action bodies; graph presentation
    metadata and other dependency analyses are not used by this client. Project
    before converting to dictionaries so those copies are not materialised.
    """
    fields = (
        "pipeline",
        "name",
        "source",
        "origin",
        "raw",
        "actions",
        "definition",
        "instance",
        "editable",
    )
    data = {
        key: api.to_dict(getattr(view, key))
        for key in (
            "environment",
            "environments",
            "catalog",
            "diagnostics",
            "stale",
            "project",
        )
    }
    data["sandbox_enabled"] = getattr(view, "sandbox_enabled", False)
    data["sandbox"] = api.to_dict(getattr(view, "sandbox", None))
    data["flowgroups"] = [
        {key: api.to_dict(getattr(flowgroup, key)) for key in fields}
        for flowgroup in view.flowgroups
    ]
    dependencies = view.dependencies
    data["dependencies"] = {}
    if dependencies is not None:
        for kind in ("action_graph", "flowgroup_graph", "pipeline_graph"):
            graph = api.to_dict(getattr(dependencies, kind))
            if graph:
                data["dependencies"][kind] = {
                    "nodes": [
                        {
                            key: node[key]
                            for key in ("id", "label", "pipeline", "flowgroup")
                            if key in node
                        }
                        for node in graph["nodes"]
                    ],
                    "edges": [
                        {
                            key: edge[key]
                            for key in ("source", "target", "dataset")
                            if key in edge
                        }
                        for edge in graph["edges"]
                    ],
                }
        for key in ("external_sources", "warnings"):
            data["dependencies"][key] = api.to_dict(getattr(dependencies, key))
    return data


def consume(events: Any, api: Any, emit: Any) -> Any:
    """Preserve public event ordering and return the terminal response JSON."""
    response = None
    for event in events:
        if isinstance(event, api.ErrorEmitted):
            continue  # Canonical stream subsequently raises its LHPError.
        payload = api.to_dict(event)
        if isinstance(event, api.OperationCompleted):
            response = payload.pop("response", None)
        emit("event", {"event": {"kind": type(event).__name__, **payload}})
    if response is None:
        raise RequestError(
            "INCOMPLETE_STREAM", "Operation ended without a terminal result."
        )
    return response


def safe_editor_message(value: str) -> str:
    """Project editor errors onto authored paths, not ephemeral mirror paths."""
    return re.sub(
        r"(?:[A-Za-z]:)?(?:[/\\][^\s/\\]+)*[/\\]lhp-\s*editor-\s*[A-Za-z0-9_-]+[/\\]",
        "",
        value,
    )


def main() -> None:
    request_id = "unknown"
    output = sys.stdout

    def emit(kind: str, body: dict[str, Any]) -> None:
        output.write(
            json.dumps(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "id": request_id,
                    "type": kind,
                    **body,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            + "\n"
        )
        output.flush()

    try:
        line = sys.stdin.buffer.readline(MAX_REQUEST + 1)
        if len(line) > MAX_REQUEST:
            raise RequestError(
                "REQUEST_LIMIT", "Bridge request exceeds the 16 MB limit."
            )
        value = json.loads(line)
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            request_id = value["id"]
        request = validate_request(value)
        os.environ.setdefault("LHP_NO_CACHE", "1")
        with contextlib.redirect_stdout(sys.stderr):
            result = dispatch(request, emit)
        emit("result", {"result": result})
    except RequestError as error:
        emit("error", {"code": error.code, "message": str(error)})
    except Exception as error:
        code = getattr(error, "code", None) or "LHP_OPERATION"
        # Structured user-facing errors only; never dump traceback/configuration.
        message = getattr(error, "message", None) or str(error)
        emit("error", {"code": str(code), "message": safe_editor_message(str(message))[:4000]})


if __name__ == "__main__":
    main()
