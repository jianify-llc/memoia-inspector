"""源码快照及缺依赖反例，不读实际业务配置或启动共享服务。"""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
