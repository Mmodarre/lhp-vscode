#!/usr/bin/env python3
"""One-request NDJSON adapter over the public Lakehouse Plumber API.

No CLI parsing, private-module imports or network listeners. The host owns
workspace trust and interpreter selection; this adapter validates its boundary.
"""

from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import sys
from typing import Any

PROTOCOL_VERSION = 1
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
        if isinstance(root, str):
            resolved = (Path(root) / filename).resolve()
            if not resolved.is_relative_to(Path(root).resolve()):
                raise RequestError(
                    "DOCUMENT_PATH", "Overlay symlinks must stay inside the project."
                )
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
        import lhp.api as api

        missing = [name for name in REQUIRED_APIS if not hasattr(api, name)]
        # release/V0.9.3 intentionally still has 0.9.2 distribution metadata.
        # Capability probes distinguish that integration build from PyPI 0.9.2.
        version = str(result["lhpVersion"])
        family = re.match(r"^0\.9\.(?:2|3)(?:$|[a-z.+-])", version) is not None
        result["compatible"] = family and not missing and sys.version_info >= (3, 11)
        result["capabilities"] = [name for name in REQUIRED_APIS if hasattr(api, name)]
        if not result["compatible"]:
            result["message"] = (
                "Install the LHP 0.9.3 integration build with editor APIs. The standard 0.9.2 package does not provide them."
            )
    except (ImportError, importlib.metadata.PackageNotFoundError) as error:
        result["message"] = (
            f"Lakehouse Plumber is not available in this interpreter ({type(error).__name__})."
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
        return api.to_dict(
            api.inspect_editor_project(
                root, env=env, overlays=overlays, pipeline_config_path=configuration
            )
        )
    if operation == "catalog":
        return api.to_dict(api.editor_catalog(root))
    if operation == "validate":
        return consume(
            api.validate_editor_project(
                root,
                env=env,
                overlays=overlays,
                pipeline_config_path=configuration,
                include_tests=True,
            ),
            api,
            emit,
        )
    if operation == "preview":
        return consume(
            api.preview_editor_project(
                root, env=env, overlays=overlays, pipeline_config_path=configuration
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
                sample_mode=False,
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
        facade = api.LakehousePlumberApplicationFacade.for_project(
            root,
            pipeline_config_path=str((root / configuration).resolve())
            if configuration
            else None,
            no_cache=True,
        )
        return consume(
            facade.generate_pipelines(
                env=env,
                output_dir=root / "generated" / env,
                include_tests=options.get("includeTests", False) is True,
                bundle_enabled=api.should_enable_bundle_support(
                    root, cli_no_bundle=False
                ),
                pipeline_filter=None,
            ),
            api,
            emit,
        )
    raise RequestError("OPERATION", "Unsupported operation.")


def consume(events: Any, api: Any, emit: Any) -> Any:
    """Preserve public event ordering and return the terminal response JSON."""
    response = None
    for event in events:
        if isinstance(event, api.ErrorEmitted):
            continue  # Canonical stream subsequently raises its LHPError.
        payload = api.to_dict(event)
        emit("event", {"event": {"kind": type(event).__name__, **payload}})
        if isinstance(event, api.OperationCompleted):
            response = payload.get("response")
    if response is None:
        raise RequestError(
            "INCOMPLETE_STREAM", "Operation ended without a terminal result."
        )
    return response


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
        emit("error", {"code": str(code), "message": str(message)[:4000]})


if __name__ == "__main__":
    main()
