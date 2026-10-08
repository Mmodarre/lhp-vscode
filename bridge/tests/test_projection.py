"""Wire projection and health categories, independent of installed LHP."""

from __future__ import annotations

import builtins
import copy
import importlib.metadata
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "lhp_bridge_test", Path(__file__).resolve().parents[1] / "lhp_bridge.py"
)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ProjectionTests(unittest.TestCase):
    def test_missing_distribution_differs_from_broken_installed_import(self):
        with patch.object(
            importlib.metadata,
            "version",
            side_effect=importlib.metadata.PackageNotFoundError("lakehouse-plumber"),
        ):
            missing = bridge.runtime_health()
        self.assertFalse(missing["compatible"])
        self.assertIn("not installed", missing["message"])
        self.assertNotIn("PackageNotFoundError", missing["message"])
        original = builtins.__import__

        def broken_import(name, *args, **kwargs):
            if name == "lhp.api":
                raise importlib.metadata.PackageNotFoundError("dependency")
            return original(name, *args, **kwargs)

        with patch.object(importlib.metadata, "version", return_value="0.9.2"):
            with patch.object(builtins, "__import__", side_effect=broken_import):
                broken = bridge.runtime_health()
        self.assertFalse(broken["compatible"])
        self.assertEqual(broken["lhpVersion"], "0.9.2")
        self.assertIn("is installed", broken["message"])
        self.assertNotIn("not installed", broken["message"])

    def test_projection_keeps_source_raw_actions_and_every_graph_member(self):
        source = {
            "path": "pipelines/a.yaml",
            "document_index": 1,
            "yaml_path": ["flowgroups", 2],
        }
        actions = [
            {
                "name": "a",
                "raw": {"unknown": [1, 2]},
                "resolved": {"sql": "select 1"},
                "source": source,
            }
        ]
        group = SimpleNamespace(
            pipeline="p",
            name="g",
            source=source,
            origin="direct",
            raw={"actions": actions},
            actions=actions,
            definition=None,
            instance=source,
            editable=True,
            resolved={"unused": "duplicate"},
            definition_raw={},
        )
        nodes = [
            {
                "id": str(i),
                "label": str(i),
                "pipeline": "p",
                "flowgroup": "g",
                "unused": "presentation",
            }
            for i in range(20001)
        ]
        edges = [
            {"source": str(i), "target": str(i + 1), "dataset": "data"}
            for i in range(20000)
        ]
        graph = {"nodes": nodes, "edges": edges}
        view = SimpleNamespace(
            project={"name": "projection", "has_monitoring": True},
            environment="dev",
            environments=["dev"],
            catalog={},
            diagnostics=[],
            stale=False,
            flowgroups=[group],
            dependencies=SimpleNamespace(
                action_graph=graph,
                flowgroup_graph=graph,
                pipeline_graph={
                    "nodes": [{"id": "p", "label": "p"}],
                    "edges": [{"source": "p", "target": "q", "dataset": "table"}],
                },
                warnings=[],
                external_sources=["external"],
            ),
        )
        projected = bridge.project_snapshot(
            view, SimpleNamespace(to_dict=copy.deepcopy)
        )
        self.assertEqual(projected["flowgroups"][0]["raw"], group.raw)
        self.assertEqual(projected["project"], view.project)
        self.assertEqual(
            projected["dependencies"]["pipeline_graph"],
            view.dependencies.pipeline_graph,
        )
        self.assertEqual(projected["flowgroups"][0]["actions"], actions)
        self.assertEqual(projected["flowgroups"][0]["source"], source)
        self.assertNotIn("resolved", projected["flowgroups"][0])
        self.assertEqual(len(projected["dependencies"]["action_graph"]["nodes"]), 20001)
        self.assertEqual(projected["dependencies"]["action_graph"]["edges"], edges)

    def test_large_terminal_result_is_emitted_once_not_repeated_in_progress(self):
        class Completed:
            pass

        result = {"files": [{"content": "x" * (33 * 1024 * 1024)}]}
        api = SimpleNamespace(
            ErrorEmitted=type("ErrorEmitted", (), {}),
            OperationCompleted=Completed,
            to_dict=lambda _: {"response": result, "message": "Complete"},
        )
        emitted = []
        actual = bridge.consume(
            [Completed()], api, lambda kind, body: emitted.append((kind, body))
        )
        self.assertIs(actual, result)
        self.assertEqual(len(emitted), 1)
        self.assertNotIn("response", emitted[0][1]["event"])
        self.assertEqual(emitted[0][1]["event"]["message"], "Complete")


if __name__ == "__main__":
    unittest.main()
