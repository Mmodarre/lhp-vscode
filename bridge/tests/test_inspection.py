"""Public inspection API regressions; synthetic temporary projects only."""

from pathlib import Path
import hashlib
import json
import os
import tempfile
import unittest
from unittest.mock import patch
import test_bridge
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lhp_inspection import rebase_mirror_paths, source_mirror


class InspectionTests(unittest.TestCase):
    request = test_bridge.BridgeTests.request

    def result(self, operation, root=None, **kwargs):
        response = self.request(operation, root, **kwargs)
        self.assertEqual(response["type"], "result", response)
        return response["result"]

    def test_mirror_canonicalizes_temp_alias_before_overlay_containment(self):
        temporary_directory = tempfile.TemporaryDirectory
        with temporary_directory() as directory:
            parent = Path(directory).resolve()
            root = parent / "project"
            root.mkdir()
            (parent / "nested").mkdir()
            (root / "lhp.yaml").write_text("name: alias_test\n", encoding="utf-8")
            # A real alias spelling exercises the containment comparison on
            # every platform without requiring permission to create symlinks.
            alias_parent = parent / "nested" / ".."
            with patch(
                "lhp_inspection.tempfile.TemporaryDirectory",
                side_effect=lambda **kwargs: temporary_directory(
                    dir=str(alias_parent), **kwargs
                ),
            ):
                with source_mirror(
                    root,
                    [{"path": "pipelines/draft.yaml", "text": "flowgroup: draft\n"}],
                ) as mirror:
                    self.assertEqual(mirror, mirror.resolve())
                    self.assertEqual(
                        (mirror / "pipelines/draft.yaml").read_text(encoding="utf-8"),
                        "flowgroup: draft\n",
                    )

    def test_dataset_mirror_excludes_nested_projects_and_rejects_their_drafts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "lhp.yaml").write_text("name: parent\n", encoding="utf-8")
            (root / "child").mkdir()
            (root / "child/lhp.yaml").write_text("name: child\n", encoding="utf-8")
            (root / "child/source.sql").write_text("SELECT 1", encoding="utf-8")
            with source_mirror(root, [], ["child"]) as mirror:
                self.assertTrue((mirror / "lhp.yaml").is_file())
                self.assertFalse((mirror / "child").exists())
            with self.assertRaisesRegex(ValueError, "nested project"):
                with source_mirror(
                    root, [{"path": "child/source.sql", "text": "SELECT 2"}], ["child"]
                ):
                    pass
            with self.assertRaises(ValueError):
                with source_mirror(root, [], ["../outside"]):
                    pass

    def test_sandbox_mirror_copies_only_bounded_exact_profile_and_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'lhp.yaml').write_text('name: mirror\n', encoding='utf-8')
            private = root / '.lhp'
            private.mkdir()
            (private / 'profile.yaml').write_text('sandbox:\n  namespace: saved\n', encoding='utf-8')
            (private / 'secret.yaml').write_text('token: private\n', encoding='utf-8')
            with source_mirror(root, [], include_profile=True) as mirror:
                self.assertTrue((mirror / '.lhp/profile.yaml').is_file())
                self.assertFalse((mirror / '.lhp/secret.yaml').exists())
            with source_mirror(root, [{'path': '.lhp/profile.yaml', 'text': 'sandbox:\n  namespace: draft\n'}], include_profile=True) as mirror:
                self.assertIn('draft', (mirror / '.lhp/profile.yaml').read_text(encoding='utf-8'))
            with source_mirror(root, [{'path': '.lhp/profile.yaml', 'text': 'bad\n'}], include_profile=False) as mirror:
                self.assertFalse((mirror / '.lhp').exists())
            with self.assertRaisesRegex(ValueError, 'Only .lhp/profile.yaml'):
                with source_mirror(root, [{'path': '.lhp/secret.yaml', 'text': 'bad\n'}], include_profile=True):
                    pass
            with self.assertRaisesRegex(ValueError, '2 MiB'):
                with source_mirror(root, [{'path': '.lhp/profile.yaml', 'text': 'x' * (2 * 1024 * 1024 + 1)}], include_profile=True):
                    pass
            with patch('lhp_inspection.MAX_MIRROR_BYTES', 45):
                with self.assertRaisesRegex(ValueError, '256 MiB'):
                    with source_mirror(root, [{'path': '.lhp/profile.yaml', 'text': 'sandbox:\n  namespace: large_draft\n'}], include_profile=True):
                        pass
            (private / 'profile.yaml').unlink()
            (private / 'profile.yaml').symlink_to(root / 'lhp.yaml')
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                with source_mirror(root, [], include_profile=True):
                    pass

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'FIFO creation is unavailable')
    def test_sandbox_profile_fifo_is_rejected_without_opening_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'lhp.yaml').write_text('name: fifo_test\n', encoding='utf-8')
            private = root / '.lhp'
            private.mkdir()
            os.mkfifo(private / 'profile.yaml')
            with self.assertRaisesRegex(ValueError, 'regular file'):
                with source_mirror(root, [], include_profile=True):
                    pass
            health = self.request('health')['result']
            if health['compatible'] and 'sandbox_editor' in health['capabilities']:
                generation = self.request('generate', root, options={'sandboxEnabled': True})
                self.assertEqual(generation['type'], 'error', generation)
                self.assertIn('regular file', generation['message'])
                self.assertFalse((root / 'generated').exists())

    def test_saved_sandbox_generation_rejects_oversize_profile(self):
        health = self.request('health')['result']
        if not health['compatible'] or 'sandbox_editor' not in health['capabilities']:
            self.skipTest('Sandbox editor core required for generation.')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'lhp.yaml').write_text('name: large_profile\n', encoding='utf-8')
            private = root / '.lhp'
            private.mkdir()
            (private / 'profile.yaml').write_bytes(b'x' * (2 * 1024 * 1024 + 1))
            generation = self.request('generate', root, options={'sandboxEnabled': True})
            self.assertEqual(generation['type'], 'error', generation)
            self.assertIn('2 MiB', generation['message'])
            self.assertFalse((root / 'generated').exists())

    def test_projected_warning_and_nested_source_strings_are_project_relative(self):
        mirror = Path(tempfile.gettempdir()) / "lhp-editor-inspection-private"
        value = {
            "warnings": [f"Could not read {mirror}/sql/missing.sql"],
            "nested": {"source": str(mirror / "pipelines" / "bad.yaml")},
        }
        projected = rebase_mirror_paths(value, mirror)
        self.assertEqual(projected["warnings"], ["Could not read sql/missing.sql"])
        self.assertNotIn(str(mirror), json.dumps(projected))

    def test_real_template_stages_configuration_preset_substitutions_and_dataset_drafts(
        self,
    ):
        if not self.result("health")["compatible"]:
            self.assertFalse(
                os.environ.get("CI"), "CI requires compatible LHP_TEST_PYTHON"
            )
            self.skipTest("Compatible editor API required")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                "lhp.yaml": 'name: inspection_test\nversion: "1.0"\n',
                "templates/reader.yaml": 'name: reader\nparameters:\n  - name: input\n    type: string\n    required: true\nactions:\n  - name: load\n    type: load\n    source:\n      type: cloudfiles\n      path: "{{ input }}"\n      format: json\n    target: v_input\n  - name: write\n    type: write\n    source: v_input\n    write_target:\n      type: streaming_table\n      catalog: main\n      schema: bronze\n      table: preview_table\n',
                "presets/common.yaml": "name: common\ndefaults:\n  readMode: stream\n",
                "substitutions/dev.yaml": "global:\n  catalog: main\ndev:\n  schema: bronze\nsecrets:\n  default_scope: references_only\n",
                "config/custom.yaml": "project_defaults:\n  catalog: main\n  schema: bronze\n",
            }
            for name, content in files.items():
                source = root / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text(content, encoding="utf-8")
            scaffold = self.result(
                "scaffold",
                root,
                options=dict(
                    kind="bronze",
                    name="orders",
                    pipeline="bronze",
                    sourcePath="/Volumes/main/source/*.json",
                    format="json",
                    target="main.bronze.orders",
                ),
            )
            source = root / "pipelines/orders.yaml"
            source.parent.mkdir()
            source.write_text(scaffold["content"], encoding="utf-8")
            before = {
                str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in root.rglob("*")
                if p.is_file()
            }
            for stage in ("inspect", "expanded", "resolved"):
                result = self.result(
                    "inspect",
                    root,
                    options=dict(
                        kind="template",
                        path="templates/reader.yaml",
                        stage=stage,
                        parameters={"input": "/Volumes/main/draft/*.json"},
                    ),
                )
                self.assertNotIn(
                    result.get("status"),
                    {"needs_context", "needs_parameters", "invalid", "error"},
                    result,
                )
                if stage == "expanded":
                    self.assertIn("draft", json.dumps(result["expanded_actions"]))
            config = self.result(
                "inspect",
                root,
                options=dict(kind="pipelineConfig", path="config/custom.yaml"),
            )
            self.assertEqual(config["source"], "saved")
            self.assertTrue(
                any("Saved files only" in warning for warning in config["warnings"])
            )
            preset = self.result(
                "inspect",
                root,
                options=dict(kind="preset", path="presets/common.yaml", name="common"),
            )
            self.assertEqual(preset["merged_config"]["readMode"], "stream")
            substitutions = self.result(
                "inspect",
                root,
                options=dict(kind="substitutions", path="substitutions/dev.yaml"),
            )
            self.assertEqual(substitutions["tokens"]["catalog"], "main")
            self.assertNotIn("secrets", substitutions["tokens"])
            self.assertIn(
                "local substitution values", " ".join(substitutions["warnings"])
            )
            draft = scaffold["content"].replace("table: orders", "table: draft_orders")
            data = self.result(
                "data",
                root,
                documents=[dict(path="pipelines/orders.yaml", text=draft, version=2)],
            )
            self.assertTrue(
                any(
                    item["fqn"] == "main.bronze.draft_orders"
                    for item in data["datasets"]
                ),
                data,
            )
            self.assertNotIn("lhp-editor-inspection-", json.dumps(data))
            invalid = scaffold["content"].replace(
                "catalog: main", "catalog: ${missing_catalog}"
            )
            failed = self.result(
                "data",
                root,
                documents=[dict(path="pipelines/orders.yaml", text=invalid, version=3)],
            )
            self.assertTrue(
                any(
                    "Failed to resolve flowgroup" in warning
                    for warning in failed["warnings"]
                ),
                failed,
            )
            self.assertNotIn("lhp-editor-inspection-", json.dumps(failed))
            after = {
                str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in root.rglob("*")
                if p.is_file()
            }
            self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
