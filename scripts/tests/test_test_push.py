"""真实本地 Git/hook 反例；只用临时 bare remote，CI 边界用可失败夹具。"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("test_push", SOURCE / "test_push.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class GitPushContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="jianify-push-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "source"
        self.repo.mkdir()
        self.remote = self.root / "remote.git"
        self.env = module.local_env()
        # 夹具不继承父 hook 的 Git 目录或真实平台凭据。
        self.env.update(GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1")
        self.git("init", "-q", "--bare", str(self.remote))
        self.git("init", "-q", "-b", "feature/fixture")
        self.git("config", "user.name", "CI Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("remote", "add", "origin", str(self.remote))
        (self.repo / "scripts").mkdir()
        (self.repo / ".githooks").mkdir()
        shutil.copy2(SOURCE / "test_push.py", self.repo / "scripts/test_push.py")
        shutil.copy2(SOURCE.parents[0] / ".githooks/pre-push", self.repo / ".githooks/pre-push")
        self.marker = self.root / "checks"
        self.ci("pass")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture baseline")
        self.helper("install", success=True)

    def git(self, *args, success=True, env=None):
        result = subprocess.run(["git", *args], cwd=self.repo, env=env or self.env,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode == 0, success, result.stderr + result.stdout)
        return result.stdout.strip()

    def helper(self, operation, success):
        result = subprocess.run([sys.executable, "scripts/test_push.py", operation],
                                cwd=self.repo, env=self.env, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode == 0, success, result.stderr + result.stdout)
        return result

    def ci(self, outcome):
        code = f"from pathlib import Path\nimport sys\nassert sys.argv[1:4] == ['--mode', 'quick', '--base'] and len(sys.argv[4]) == 40\np=Path({str(self.marker)!r})\np.write_text(p.read_text()+'check\\n' if p.exists() else 'check\\n')\n"
        if outcome == "fail":
            code += "raise SystemExit(1)\n"
        if outcome == "change":
            code += "Path('changed.txt').write_text('changed after validation')\n"
        (self.repo / "scripts/verify_local.py").write_text(code)

    def test_normal_push_skips_checks_direct_test_is_rejected_checked_push_runs_once(self):
        self.git("push", "origin", "HEAD:refs/heads/feature/fixture")
        self.assertFalse(self.marker.exists())
        self.git("push", "origin", "HEAD:refs/heads/test", success=False)
        self.assertFalse(self.marker.exists())
        self.helper("push", success=True)
        self.assertEqual(self.marker.read_text(), "check\n")
        self.assertEqual(self.git("ls-remote", "origin", "refs/heads/test").split()[0], self.git("rev-parse", "HEAD"))
        self.git("push", "origin", ":refs/heads/test", success=False)

    def test_failed_ci_does_not_update_remote(self):
        self.ci("fail")
        self.git("add", ".")
        self.git("commit", "-qm", "failing CI fixture")
        self.helper("push", success=False)
        self.assertEqual(self.git("ls-remote", "origin", "refs/heads/test"), "")
        self.assertEqual(self.marker.read_text(), "check\n")

    def test_dirty_or_changed_source_never_pushes(self):
        (self.repo / "dirty").write_text("uncommitted")
        self.helper("push", success=False)
        self.assertFalse(self.marker.exists())
        (self.repo / "dirty").unlink()
        self.ci("change")
        self.git("add", ".")
        self.git("commit", "-qm", "changing source fixture")
        self.helper("push", success=False)
        self.assertEqual(self.git("ls-remote", "origin", "refs/heads/test"), "")

    def test_stale_proof_and_force_update_are_rejected(self):
        self.helper("push", success=True)
        old = self.git("rev-parse", "HEAD")
        (self.repo / "new").write_text("new")
        self.git("add", ".")
        self.git("commit", "-qm", "new fixture")
        new = self.git("rev-parse", "HEAD")
        environment = dict(self.env, JIANIFY_TEST_LOCAL_CI_PROOF=f"{new}:{module.ZERO}")
        self.git("push", "origin", "HEAD:refs/heads/test", success=False, env=environment)
        self.helper("push", success=True)
        self.git("reset", "--hard", old)
        environment = dict(self.env, JIANIFY_TEST_LOCAL_CI_PROOF=f"{old}:{new}")
        self.git("push", "--force", "origin", "HEAD:refs/heads/test", success=False, env=environment)

    def test_existing_hook_manager_is_preserved(self):
        self.git("config", "core.hooksPath", "/fixture/existing-hooks")
        self.helper("install", success=False)
        self.assertEqual(self.git("config", "--get", "core.hooksPath"), "/fixture/existing-hooks")


class ExecutionContract(unittest.TestCase):
    def test_platform_credentials_are_not_inherited(self):
        with patch.dict(os.environ, {"DATABASE_URL": "shared", "OPENAI_API_KEY": "private", "GH_TOKEN": "private"}):
            self.assertNotIn("DATABASE_URL", module.local_env())
            self.assertNotIn("OPENAI_API_KEY", module.local_env())
            self.assertNotIn("GH_TOKEN", module.local_env())

    def test_transport_proxy_is_retained_without_credentials(self):
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://127.0.0.1:7890"}):
            self.assertEqual(module.local_env()["HTTPS_PROXY"], "http://127.0.0.1:7890")
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://private:password@127.0.0.1:7890"}):
            with self.assertRaisesRegex(ValueError, "LOCAL_PROXY_AUTH_FORBIDDEN"):
                module.local_env()

    def test_expired_budget_never_starts_another_step(self):
        with patch.object(module.subprocess, "Popen") as spawn:
            with self.assertRaises(subprocess.TimeoutExpired):
                module.run([sys.executable, "-c", "raise SystemExit(0)"], timeout=0)
            spawn.assert_not_called()

    def test_failed_and_uncooperative_children_stop(self):
        with self.assertRaises(subprocess.CalledProcessError):
            module.run([sys.executable, "-c", "raise SystemExit(3)"], timeout=1)
        with self.assertRaises(subprocess.TimeoutExpired):
            module.run([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)"], timeout=0.1)


if __name__ == "__main__":
    unittest.main()
