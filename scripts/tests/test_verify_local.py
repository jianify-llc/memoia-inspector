"""源码快照及缺依赖反例，不读实际业务配置或启动共享服务。"""
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location("verify_local", SOURCE / "verify_local.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class LocalVerificationContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ci-source-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.target = self.root / "copy"
        self.target.mkdir()
        subprocess.run(["git", "init", "-q", str(self.source)], check=True, timeout=5)
        for name in (".env.local", ".env.example", "src/server/api/config.yaml", "src/server/api/config.yaml.example", "source.py"):
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture only")
        subprocess.run(["git", "add", "-f", "."], cwd=self.source, check=True, timeout=5)

    def copy(self):
        with patch.object(module, "ROOT", self.source):
            module.snapshot(self.target)

    def test_business_config_is_excluded_but_templates_and_source_are_kept(self):
        self.copy()
        self.assertFalse((self.target / ".env.local").exists())

        for name in (".env.example", "src/server/api/config.yaml.example", "source.py"):
            self.assertTrue((self.target / name).is_file())

    def test_external_symlink_cannot_smuggle_host_files(self):
        (self.source / "outside.py").symlink_to(self.root / "private")
        (self.root / "private").write_text("fixture private")
        subprocess.run(["git", "add", "outside.py"], cwd=self.source, check=True, timeout=5)
        with self.assertRaisesRegex(ValueError, "CI_SOURCE_SYMLINK_FORBIDDEN"):
            self.copy()

    def test_missing_dependency_fails_before_any_container_or_source_operation(self):
        with patch.object(module.shutil, "which", return_value=None), patch.object(module, "run") as run:
            with self.assertRaisesRegex(ValueError, "LOCAL_CI_DEPENDENCY_MISSING"):
                module.verify()
            run.assert_not_called()

    def test_publish_never_infers_a_historical_baseline(self):
        with patch.object(module, "run") as run:
            self.assertFalse(module.tools_required("publish"))
            run.assert_not_called()

    def test_diff_selects_tools_and_missing_baseline_expands_checks(self):
        with patch.object(module, "run", return_value="app/api/memobase/config/route.ts\0"):
            self.assertFalse(module.tools_required("quick", "a" * 40))
        for path in ("scripts/test_push.py", "Dockerfile", "deploy/compose.yml", "tests/workflow-contract.test.ts"):
            with patch.object(module, "run", return_value=path + "\0"):
                self.assertTrue(module.tools_required("pr", "a" * 40))
        with patch.object(module, "run", side_effect=subprocess.CalledProcessError(1, "git")):
            self.assertTrue(module.tools_required("quick", "a" * 40))

    def test_checkout_is_used_directly_without_copy(self):
        with patch.object(module, "ROOT", self.source), patch.object(module, "run", return_value=""), patch.object(module, "snapshot") as snapshot:
            with module.source_tree(True, self.root) as source:
                self.assertEqual(source, self.source)
            snapshot.assert_not_called()

    def test_caught_network_attempt_still_fails_quick(self):
        result = subprocess.run(["node", "--import", str(SOURCE / "offline-node.mjs"), "-e", "try { require('node:net').connect(1, '127.0.0.1'); } catch {}"], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)

    def test_absent_owned_resources_do_not_mask_the_original_failure(self):
        with patch.object(module, "run", return_value="") as run:
            module.cleanup_owned("fixture-owned", True, True)
            self.assertEqual(run.call_count, 2)
            self.assertTrue(all("ls" in call.args[0] for call in run.call_args_list))

    def test_cleanup_inspection_or_removal_failure_is_not_success(self):
        failure = subprocess.CalledProcessError(1, "docker")
        for outcomes in ([failure], ["owned-id", failure]):
            with patch.object(module, "run", side_effect=outcomes):
                with self.assertRaisesRegex(ValueError, "LOCAL_CI_CLEANUP_FAILED"):
                    module.cleanup_owned("fixture-owned", True, False)

    def test_primary_failure_is_not_replaced_by_cleanup_failure(self):
        stderr = io.StringIO()
        with patch.object(module, "run", side_effect=subprocess.CalledProcessError(1, "docker")), redirect_stderr(stderr):
            with self.assertRaisesRegex(RuntimeError, "PRIMARY_FAILURE"):
                try:
                    raise RuntimeError("PRIMARY_FAILURE")
                finally:
                    module.cleanup_owned("fixture-owned", True, False)
        self.assertIn("LOCAL_CI_CLEANUP_FAILED", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
