"""Real subprocess/API integration; no existing LHP E2E fixtures are changed."""

from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "lhp_bridge.py"
PYTHON = os.environ.get("LHP_TEST_PYTHON", sys.executable)


class BridgeTests(unittest.TestCase):
    def request(self, operation, root=None, **kwargs):
        payload = dict(
            protocolVersion=2, id="test-request", operation=operation, **kwargs
        )
        if root is not None:
            payload["projectRoot"] = str(root)
        process = subprocess.run(
            [PYTHON, "-u", str(SCRIPT)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=90,
        )
        self.assertEqual(process.returncode, 0, process.stderr[-300:])
        messages = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertTrue(messages)
        self.assertTrue(all(message["id"] == "test-request" for message in messages))
        return messages[-1]

    def test_boundary_rejects_traversal_and_unknown_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            error = self.request(
                "snapshot",
                directory,
                documents=[dict(path="../outside.yaml", text="x", version=1)],
            )
            self.assertEqual(error["code"], "DOCUMENT_PATH")
        self.assertEqual(self.request("shell")["code"], "OPERATION")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(self.request('snapshot', root, documents=[dict(path='.lhp/private.yaml', text='x', version=1)])['code'], 'DOCUMENT_PATH')
            self.assertEqual(self.request('snapshot', root, documents=[dict(path='.lhp/profile.yaml', text='x' * (2 * 1024 * 1024 + 1), version=1)])['code'], 'DOCUMENT_LIMIT')
            (root / '.lhp').symlink_to(root, target_is_directory=True)
            self.assertEqual(self.request('snapshot', root, documents=[dict(path='.lhp/profile.yaml', text='x', version=1)])['code'], 'DOCUMENT_PATH')

    def test_real_project_lifecycle_and_unsaved_preview(self):
        health = self.request("health")["result"]
        if not health["compatible"]:
            self.assertFalse(
                os.environ.get("CI"), "CI requires compatible LHP_TEST_PYTHON"
            )
            self.skipTest(
                "Set LHP_TEST_PYTHON to the compatible integration interpreter for the real API gate."
            )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "new-project"
            result = self.request(
                "init", root, options=dict(name="bridge_test", bundle=True)
            )
            self.assertEqual(result["type"], "result", result)
            self.assertTrue(result["result"]["success"], result)
            self.assertTrue((root / "databricks.yml").exists())
            (root / "config/pipeline_config.yaml").write_text(
                "project_defaults:\n  catalog: main\n  schema: bronze\n"
            )
            scaffold = self.request(
                "scaffold",
                root,
                options=dict(
                    kind="bronze",
                    name="orders",
                    pipeline="bronze",
                    sourcePath="/Volumes/main/landing/orders/*.json",
                    format="json",
                    target="main.bronze.orders",
                ),
            )
            self.assertEqual(scaffold["type"], "result", scaffold)
            file = root / "pipelines/orders.yaml"
            file.parent.mkdir(exist_ok=True)
            file.write_text(scaffold["result"]["content"])
            snapshot = self.request(
                "snapshot",
                root,
                options=dict(pipelineConfigPath="config/pipeline_config.yaml"),
            )
            self.assertEqual(snapshot["type"], "result", snapshot)
            self.assertEqual(len(snapshot["result"]["flowgroups"]), 1)
            self.assertTrue(snapshot["result"]["dependencies"]["action_graph"]["edges"])
            catalog = snapshot["result"]["catalog"]
            self.assertTrue(catalog["action_schema"]["properties"]["test_type"])
            validation = self.request(
                "validate",
                root,
                options=dict(pipelineConfigPath="config/pipeline_config.yaml"),
            )
            self.assertEqual(validation["type"], "result", validation)
            self.assertTrue(validation["result"]["success"], validation)
            draft = file.read_text().replace("orders/*.json", "draft_orders/*.json")
            preview = self.request(
                "preview",
                root,
                options=dict(pipelineConfigPath="config/pipeline_config.yaml"),
                documents=[dict(path="pipelines/orders.yaml", text=draft, version=2)],
            )
            self.assertEqual(preview["type"], "result", preview)
            self.assertTrue(
                any(
                    "draft_orders" in item["content"]
                    for item in preview["result"]["files"]
                )
            )
            self.assertNotIn("draft_orders", file.read_text())
            generation = self.request(
                "generate",
                root,
                options=dict(pipelineConfigPath="config/pipeline_config.yaml"),
            )
            self.assertEqual(generation["type"], "result", generation)
            self.assertTrue(generation["result"]["success"], generation)
            self.assertTrue(list((root / "generated/dev").rglob("*.py")))
            profile = root / '.lhp/profile.yaml'
            profile.parent.mkdir(exist_ok=True)
            profile.write_text('sandbox:\n  namespace: alice\n  pipelines:\n    - bronze\n', encoding='utf-8')
            sandbox_options = dict(pipelineConfigPath='config/pipeline_config.yaml', sandboxEnabled=True)
            sandbox_snapshot = self.request('snapshot', root, options=sandbox_options)
            if 'sandbox_editor' not in health['capabilities']:
                self.assertEqual(sandbox_snapshot['code'], 'SANDBOX_RUNTIME_UPGRADE')
            else:
                self.assertEqual(sandbox_snapshot['type'], 'result', sandbox_snapshot)
                self.assertTrue(sandbox_snapshot['result']['sandbox_enabled'])
                self.assertEqual(sandbox_snapshot['result']['sandbox']['resolved_pipelines'], ['bronze'])
                sandbox_data = self.request('data', root, options=sandbox_options)
                self.assertEqual(sandbox_data['type'], 'result', sandbox_data)
                self.assertTrue(sandbox_data['result']['sandbox_enabled'])
                self.assertEqual(sandbox_data['result']['lineage_scope'], 'all-authored')
                self.assertEqual(sandbox_data['result']['sandbox']['namespace'], 'alice')
                sandbox_preview = self.request('preview', root, options=sandbox_options)
                self.assertEqual(sandbox_preview['type'], 'result', sandbox_preview)
                self.assertTrue(sandbox_preview['result']['files'])
            self.assertEqual(
                self.request(
                    "generate",
                    root,
                    documents=[
                        dict(path="pipelines/orders.yaml", text=draft, version=2)
                    ],
                )["code"],
                "UNSAVED_GENERATION",
            )
            empty = Path(temporary) / "empty-project"
            empty.mkdir()
            self.assertTrue(
                self.request("init", empty, options=dict(name="empty", bundle=False))[
                    "result"
                ]["success"]
            )

    def test_template_blueprint_scaffolds(self):
        if not self.request("health")["result"]["compatible"]:
            self.assertFalse(
                os.environ.get("CI"), "CI requires compatible LHP_TEST_PYTHON"
            )
            self.skipTest("Compatible integration interpreter required.")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "project"
            self.assertTrue(
                self.request(
                    "init", root, options=dict(name="instances", bundle=False)
                )["result"]["success"]
            )
            template_dir = root / "templates/ingestion"
            template_dir.mkdir(parents=True, exist_ok=True)
            (template_dir / "reader.yaml").write_text(
                'name: reader\nversion: "1.0"\nparameters:\n  - name: input_path\n    type: string\n    required: true\nactions:\n  - name: load_data\n    type: load\n    source:\n      type: cloudfiles\n      path: "{{ input_path }}"\n      format: json\n    target: v_data\n'
            )
            template = self.request(
                "scaffold",
                root,
                options=dict(
                    kind="template",
                    definition="ingestion/reader",
                    name="read_orders",
                    pipeline="bronze",
                    parameters={"input_path": "/Volumes/main/source/*.json"},
                ),
            )
            self.assertEqual(template["type"], "result", template)
            self.assertIn("ingestion/reader", template["result"]["content"])
            blueprint_dir = root / "blueprints"
            blueprint_dir.mkdir(exist_ok=True)
            (blueprint_dir / "empty.yaml").write_text(
                'name: empty\nversion: "1.0"\nparameters:\n  - name: table\n    type: string\n    required: true\nflowgroups: []\n'
            )
            blueprint = self.request(
                "scaffold",
                root,
                options=dict(
                    kind="blueprint",
                    definition="empty",
                    name="instance",
                    pipeline="bronze",
                    parameters={"table": "orders"},
                ),
            )
            self.assertEqual(blueprint["type"], "result", blueprint)
            self.assertIn("empty", blueprint["result"]["content"])


if __name__ == "__main__":
    unittest.main()
