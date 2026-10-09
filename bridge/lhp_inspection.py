"""Read-only editor operations through public LHP APIs only."""

from __future__ import annotations

import contextlib
import os
from pathlib import Path
import shutil
import stat
import tempfile
from typing import Any, Iterator

MAX_MIRROR_FILES = 50000
MAX_MIRROR_BYTES = 256 * 1024 * 1024
MAX_PROFILE_BYTES = 2 * 1024 * 1024
PROFILE_PATH = '.lhp/profile.yaml'


def checked_profile_path(root: Path) -> Path:
    """The sole private editor input must remain a direct regular project child."""
    private_dir = root / '.lhp'
    profile = private_dir / 'profile.yaml'
    if private_dir.is_symlink() or profile.is_symlink():
        raise ValueError('Sandbox profile must not use symlinks.')
    if private_dir.exists() and not private_dir.is_dir():
        raise ValueError('Sandbox profile parent is not a directory.')
    if private_dir.resolve() != private_dir or profile.resolve().parent != private_dir:
        raise ValueError('Sandbox profile path escapes the active project.')
    try:
        profile_info = profile.lstat()
    except FileNotFoundError:
        pass
    else:
        if not stat.S_ISREG(profile_info.st_mode):
            raise ValueError('Sandbox profile must be a regular file.')
        if profile_info.st_size > MAX_PROFILE_BYTES:
            raise ValueError('Sandbox profile exceeds 2 MiB.')
    return profile


def project_file(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("A project-relative resource path is required.")
    source = Path(value)
    if source.is_absolute() or any(part in {".", ".."} for part in source.parts):
        raise ValueError("Resource paths must stay inside the project.")
    candidate = (root / source).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise ValueError("The requested resource is missing or outside the project.")
    return candidate


@contextlib.contextmanager
def source_mirror(
    root: Path,
    documents: list[dict[str, Any]],
    nested_roots: list[str] | None = None,
    *,
    include_profile: bool = False,
) -> Iterator[Path]:
    """Isolate inspection dependencies, including unsaved source, from all writes.

    Copy authoring files only; no symlinks, environment/cache data, arbitrary
    binary input datasets, or generated output. Enforce a disclosed copy budget.
    """
    root = root.resolve()
    ignored = {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        ".tmp",
        ".lhp",
        ".databricks",
        ".superdesign",
        "__pycache__",
        "generated",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        "dist",
    }
    excluded = []
    for value in nested_roots or []:
        if (
            not isinstance(value, str)
            or not value
            or "\\" in value
            or Path(value).is_absolute()
            or ".." in Path(value).parts
        ):
            raise ValueError(
                "Nested project boundaries must be project-relative paths."
            )
        candidate = (root / value).resolve()
        if candidate == root or not candidate.is_relative_to(root):
            raise ValueError("Nested project boundary escapes the active project.")
        excluded.append(candidate)
    suffixes = {
        ".yaml",
        ".yml",
        ".sql",
        ".py",
        ".json",
        ".ddl",
        ".toml",
        ".jinja",
        ".j2",
        ".tmpl",
    }
    with tempfile.TemporaryDirectory(prefix="lhp-editor-inspection-") as temporary:
        # Temp providers may return an alias (/var on macOS, short paths on
        # Windows). Compare overlay targets against the same canonical root.
        mirror = Path(temporary).resolve()
        total = 0
        count = 0
        pending = [root]
        while pending:
            directory = pending.pop()
            for source in directory.iterdir():
                if source.is_symlink():
                    continue
                if source.is_dir():
                    if (
                        source.name not in ignored
                        and source.resolve() not in excluded
                        and not (source / "lhp.yaml").is_file()
                    ):
                        pending.append(source)
                    continue
                if source.suffix.lower() not in suffixes:
                    continue
                count += 1
                total += source.stat().st_size
                if count > MAX_MIRROR_FILES or total > MAX_MIRROR_BYTES:
                    raise ValueError(
                        "Inspection source mirror exceeds 50,000 files or 256 MiB. Reduce the project authoring scope."
                    )
                relative = source.relative_to(root)
                target = mirror / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        if include_profile:
            profile = checked_profile_path(root)
            if profile.exists():
                # O_NONBLOCK prevents a replacement FIFO from hanging before
                # fstat can reject it. The lstat above rejects a saved FIFO.
                flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
                descriptor = os.open(profile, flags)
                try:
                    info = os.fstat(descriptor)
                    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PROFILE_BYTES:
                        raise ValueError('Sandbox profile must be a regular file of at most 2 MiB.')
                    with os.fdopen(descriptor, 'rb', closefd=False) as stream:
                        content = stream.read(MAX_PROFILE_BYTES + 1)
                    if len(content) > MAX_PROFILE_BYTES:
                        raise ValueError('Sandbox profile exceeds 2 MiB.')
                finally:
                    os.close(descriptor)
                checked_profile_path(root)
                total += len(content)
                count += 1
                if count > MAX_MIRROR_FILES or total > MAX_MIRROR_BYTES:
                    raise ValueError('Inspection source mirror including sandbox profile exceeds its 50,000 file or 256 MiB budget.')
                target = mirror / PROFILE_PATH
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
        for document in documents:
            filename = document["path"]
            if not isinstance(filename, str) or not filename or '\\' in filename or Path(filename).is_absolute() or any(part in {'', '.', '..'} for part in filename.split('/')):
                raise ValueError('An editor draft path must be a canonical project-relative path.')
            if filename.startswith('.lhp/'):
                if filename != PROFILE_PATH:
                    raise ValueError('Only .lhp/profile.yaml may enter the inspection mirror.')
                if not include_profile:
                    continue
                checked_profile_path(root)
                if len(document['text'].encode('utf-8')) > MAX_PROFILE_BYTES:
                    raise ValueError('Sandbox profile draft exceeds 2 MiB.')
            original = (root / filename).resolve()
            if (
                any(original.is_relative_to(nested) for nested in excluded)
                or (filename != PROFILE_PATH and any(part in ignored for part in Path(filename).parts))
                or any(
                    (parent / "lhp.yaml").is_file()
                    for parent in original.parents
                    if parent != root and parent.is_relative_to(root)
                )
            ):
                raise ValueError(
                    "An editor draft belongs to an excluded or nested project."
                )
            target = (mirror / filename).resolve()
            if not target.is_relative_to(mirror):
                raise ValueError("Overlay path escapes the inspection project.")
            total += len(document["text"].encode("utf-8"))
            count += 1
            if count > MAX_MIRROR_FILES or total > MAX_MIRROR_BYTES:
                raise ValueError(
                    "Inspection source mirror including editor drafts exceeds 50,000 files or 256 MiB."
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(document["text"], encoding="utf-8")
        yield mirror


def inspect_resource(
    api: Any, root: Path, env: str, options: dict[str, Any], configuration: str | None
) -> Any:
    kind = options.get("kind")
    filename = options.get("path")
    source = project_file(root, filename)
    if kind == "template":
        text = options.get("sourceYaml")
        if not isinstance(text, str):
            text = source.read_text(encoding="utf-8")
        return api.preview_template(
            root,
            request={
                "source_path": filename,
                "source_yaml": text,
                "stage": options.get("stage", "inspect"),
                "sample_parameters": options.get("parameters", {}),
                "context": {
                    "environment": env,
                    "pipeline": options.get("pipeline", "preview"),
                    "flowgroup": "preview",
                },
            },
        )
    if kind in {"pipelineConfig", "jobConfig"}:
        return api.preview_configuration(
            root,
            path=filename,
            kind="pipeline" if kind == "pipelineConfig" else "job",
            env=env,
            target=options.get("target", ""),
        )
    facade = api.LakehousePlumberApplicationFacade.for_project(
        root,
        no_cache=True,
        pipeline_config_path=str(root / configuration) if configuration else None,
    )
    if kind == "preset":
        candidates = [
            view
            for view in facade.inspection.list_presets()
            if Path(view.file_path).resolve() == source
        ]
        name = options.get("name")
        selected = next((view for view in candidates if view.name == name), None)
        if selected is None:
            raise ValueError(
                "Preset source no longer matches the selected catalogue entry."
            )
        return api.to_dict(facade.inspection.resolve_preset(selected.name))
    if kind == "substitutions":
        if source.parent != root / "substitutions":
            raise ValueError("Choose an environment substitution file.")
        result = api.to_dict(facade.inspection.build_substitution_view(source.stem))
        result["warnings"] = [
            "Shows local substitution values and raw mappings from the saved file, including any sensitive literals stored there. Secret references are not resolved and no remote secret lookup occurs. The observed-reference list may be incomplete."
        ]
        return result
    raise ValueError("Unsupported inspection kind.")


def dataset_index(
    api: Any,
    root: Path,
    env: str,
    configuration: str | None,
    documents: list[dict[str, Any]],
    nested_roots: list[str] | None = None,
    *,
    sandbox: bool = False,
) -> Any:
    with source_mirror(root, documents, nested_roots, include_profile=sandbox) as mirror:
        facade = api.LakehousePlumberApplicationFacade.for_project(
            mirror,
            no_cache=True,
            pipeline_config_path=str(mirror / configuration) if configuration else None,
        )
        view = facade.dependency.build_dataset_index(env=env, force_rebuild=True)
        datasets = []
        for dataset in view.datasets:
            # Data view is table-to-table lineage. Action graph remains in the
            # independently loaded snapshot; do not duplicate it per table.
            item = {
                key: api.to_dict(getattr(dataset, key))
                for key in (
                    "fqn",
                    "kind",
                    "pipeline",
                    "flowgroup",
                    "action_name",
                    "consumers",
                )
            }
            source = Path(dataset.source_file)
            item["source_file"] = (
                source.relative_to(mirror).as_posix()
                if source.is_absolute() and source.is_relative_to(mirror)
                else str(source)
            )
            item["upstream"] = [
                api.to_dict(node)
                for node in dataset.nodes
                if node.kind in {"dataset", "external"}
            ]
            datasets.append(item)
        result = {
            "env": view.env,
            "datasets": datasets,
            "warnings": api.to_dict(view.warnings),
            "fingerprint": view.fingerprint,
            "sandbox_enabled": sandbox,
            "sandbox": api.to_dict(facade.sandbox.describe_scope(env=env)) if sandbox else None,
            "lineage_scope": "all-authored",
        }
        return rebase_mirror_paths(result, mirror)


def rebase_mirror_paths(value: Any, mirror: Path) -> Any:
    """Keep projected warnings/source strings useful without exposing temp paths."""
    if isinstance(value, str):
        for prefix in {str(mirror), mirror.as_posix()}:
            value = (
                value.replace(prefix + "/", "")
                .replace(prefix + "\\", "")
                .replace(prefix, ".")
            )
        return value
    if isinstance(value, list):
        return [rebase_mirror_paths(item, mirror) for item in value]
    if isinstance(value, dict):
        return {key: rebase_mirror_paths(item, mirror) for key, item in value.items()}
    return value
