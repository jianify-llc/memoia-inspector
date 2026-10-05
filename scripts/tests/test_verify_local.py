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

    def test_diff_selects_tools_and_missing_baseline_expands_checks(self):
        with patch.object(module, "changed_paths", return_value=["app/api/memobase/config/route.ts"]):
            self.assertEqual(module.verification_scope("full", "a" * 40), dict(business=True, tools=False, build=False))
        for path in ("scripts/test_push.py", "Dockerfile", "deploy/compose.yml", "tests/workflow-contract.test.ts"):
            with patch.object(module, "changed_paths", return_value=[path]):
                self.assertTrue(module.verification_scope("full", "a" * 40)["tools"])
        with patch.object(module, "run", side_effect=subprocess.CalledProcessError(1, "git")):
            self.assertEqual(module.verification_scope("full", "a" * 40), dict(business=True, tools=True, build=True))
        self.assertEqual(module.verification_scope("full"), dict(business=True, tools=True, build=True))

    def test_quick_has_no_deployment_tools_audit_or_image_build(self):
        with patch.object(module, "run") as run:
            self.assertEqual(module.verification_scope("quick"), dict(business=True, tools=False, build=False))
            run.assert_not_called()

    def test_build_and_dependency_changes_require_a_local_image(self):
        for path in ("Dockerfile", ".dockerignore", ".npmrc", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "package.json", "pnpm-lock.yaml", "vendor/sdk.tgz"):
            with patch.object(module, "changed_paths", return_value=[path]):
                self.assertTrue(module.verification_scope("full", "a" * 40)["build"], path)
        for path in ("README.md", "app/page.tsx", "scripts/test_push.py", "deploy/compose.yml"):
            with patch.object(module, "changed_paths", return_value=[path]):
                self.assertFalse(module.verification_scope("full", "a" * 40)["build"], path)

    def test_business_selection_covers_actual_cross_directory_dependencies(self):
        for path in ("api/http.ts", "utils/memoia/client.ts", "messages/zh.json", "i18n/request.ts", "types/index.ts", "open-next.config.ts", "cloudflare-env.d.ts", "tests/sdk-source-contract.test.ts"):
            with patch.object(module, "changed_paths", return_value=[path]):
                scope = module.verification_scope("full", "a" * 40)
                self.assertTrue(scope["business"], path)
                self.assertFalse(scope["tools"], path)
                self.assertFalse(scope["build"], path)

    def test_multicommit_base_covers_earlier_tool_changes_and_exact_empty_diff(self):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.source, text=True).strip()
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.invalid")
        git("commit", "-qm", "base")
        base = git("rev-parse", "HEAD")
        (self.source / "Dockerfile").write_text("FROM fixture")
        git("add", ".")
        git("commit", "-qm", "image")
        (self.source / "README.md").write_text("docs")
        git("add", ".")
        git("commit", "-qm", "docs")
        with patch.object(module, "ROOT", self.source):
            self.assertEqual(module.verification_scope("full", base), dict(business=True, tools=True, build=True))
            self.assertEqual(module.verification_scope("full", git("rev-parse", "HEAD")), dict(business=False, tools=False, build=False))
            # 比较为零但快照会带入未提交内容时，不能宣称无须检查。
            (self.source / "README.md").write_text("uncommitted")
            self.assertEqual(module.verification_scope("full", git("rev-parse", "HEAD")), dict(business=True, tools=True, build=True))
        with self.assertRaisesRegex(ValueError, "CI_BASE_INVALID"):
            module.verification_scope("full", "HEAD^")

    def test_full_with_unrelated_diff_does_not_prepare_any_environment(self):
        with patch.object(module, "changed_paths", return_value=["README.md"]), patch.object(module.shutil, "which") as which, patch.object(module, "snapshot") as snapshot:
            module.verify("full", "a" * 40)
            which.assert_not_called()
            snapshot.assert_not_called()

    def test_nonancestor_baseline_expands_even_when_branch_diff_is_only_docs(self):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.source, text=True).strip()
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.invalid")
        git("commit", "-qm", "base")
        ancestor = git("rev-parse", "HEAD")
        git("checkout", "-qb", "candidate")
        (self.source / "README.md").write_text("candidate docs")
        git("add", ".")
        git("commit", "-qm", "candidate")
        git("checkout", "-qb", "diverged", ancestor)
        (self.source / "README.md").write_text("other branch docs")
        git("add", ".")
        git("commit", "-qm", "diverged")
        base = git("rev-parse", "HEAD")
        git("checkout", "-q", "candidate")
        with patch.object(module, "ROOT", self.source):
            self.assertEqual(module.verification_scope("full", base), dict(business=True, tools=True, build=True))

    def test_selected_scope_drives_actual_commands_without_duplicate_host_build(self):
        for scope in (
            dict(business=True, tools=False, build=False),
            dict(business=False, tools=True, build=False),
            dict(business=True, tools=True, build=True),
        ):
            commands = []
            def command(args, **kwargs):
                commands.append(args)
                if args[:3] == ["docker", "context", "inspect"]:
                    return "unix:///fixture"
                if args == ["git", "rev-parse", "HEAD"]:
                    return "a" * 40
                return ""
            with patch.object(module, "verification_scope", return_value=scope), patch.object(module.shutil, "which", return_value="fixture"), patch.object(module, "snapshot"), patch.object(module, "deployment_fixtures") as fixtures, patch.object(module, "run", side_effect=command):
                module.verify("full", "b" * 40)
            self.assertEqual(["pnpm", "typecheck"] in commands, scope["business"])
            self.assertEqual(["pnpm", "audit", "--prod", "--audit-level", "high", "--registry=https://registry.npmjs.org"] in commands, scope["business"])
            builds = [args for args in commands if args[:2] == ["docker", "build"]]
            self.assertEqual(len(builds), int(scope["build"]))
            if builds:
                self.assertIn("SOURCE_REVISION=" + "a" * 40, builds[0])
            self.assertNotIn(["pnpm", "build"], commands)
            self.assertEqual(fixtures.call_count, int(scope["tools"]))
            tests = [args for args in commands if args[:2] == ["pnpm", "test"]]
            self.assertEqual(len(tests), 1)
            if not scope["business"]:
                self.assertEqual(tests[0], ["pnpm", "test", "tests/workflow-contract.test.ts"])

    def test_verification_always_copies_source_without_git_credentials(self):
        subprocess.run(["git", "config", "remote.origin.url", "https://fixture-token@example.invalid/repo"], cwd=self.source, check=True, timeout=5)
        with tempfile.TemporaryDirectory(prefix="isolated-source-fixture-") as temporary, patch.object(module, "ROOT", self.source):
            with module.source_tree(temporary) as source:
                self.assertNotEqual(source, self.source)
                self.assertTrue((source / "source.py").is_file())
                self.assertFalse((source / ".env.local").exists())
                self.assertFalse((source / ".git").exists())

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
