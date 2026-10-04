"""Inspector 本地与远端 Verify 共用入口；临时源码，不读取业务 .env。"""
import json
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

from test_push import ROOT, local_env, run


def snapshot(destination):
    paths = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT
    ).decode().split("\0")
    for name in dict.fromkeys(paths):
        if not name:
            continue
        path = Path(name)
        if any(part.startswith(".env") and not part.endswith(".example") for part in path.parts):
            continue
        origin = ROOT / path
        if not origin.exists():
            continue
        if origin.is_symlink() or ".." in path.parts:
            raise ValueError("CI_SOURCE_SYMLINK_FORBIDDEN: " + name)
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target)


def verify():
    env = local_env()
    for command in ("pnpm", "node", "shellcheck", "docker"):
        if not shutil.which(command):
            raise ValueError("LOCAL_CI_DEPENDENCY_MISSING: " + command)
    endpoint = run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
                   env=env, capture=True, timeout=15)
    if not endpoint.startswith(("unix://", "npipe://")):
        raise ValueError("LOCAL_DOCKER_REQUIRED")
    deadline = time.monotonic() + 1800
    container = "inspector-ci-" + uuid.uuid4().hex
    started = False

    def step(command, cwd, capture=False):
        print("本地 CI：" + " ".join(command), flush=True)
        return run(command, cwd=cwd, env=env, timeout=deadline - time.monotonic(), capture=capture)

    try:
        with tempfile.TemporaryDirectory(prefix="inspector-local-ci-") as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            snapshot(source)
            env.update(NPM_CONFIG_USERCONFIG="/dev/null", NPM_CONFIG_GLOBALCONFIG="/dev/null")
            package = json.loads((source / "package.json").read_text())
            if package["dependencies"]["next"] != "15.5.26":
                raise ValueError("REVIEWED_NEXT_VERSION_CHANGED")
            step(["pnpm", "install", "--frozen-lockfile"], source)
            step([sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-v"], source)
            for command in ("check:sdk", "test", "typecheck", "lint", "build"):
                step(["pnpm", command], source)
            step(["pnpm", "audit", "--prod", "--audit-level", "high", "--registry=https://registry.npmjs.org"], source)
            step(["shellcheck", *map(str, sorted((source / "deploy").glob("*.sh"))),
                  "tests/deploy-inspector.test.sh", ".githooks/pre-push"], source)
            shutil.copy2(source / "deploy/runtime.env.example", source / "deploy/.env")
            env["INSPECTOR_IMAGE"] = "ghcr.io/jianify-llc/memoia-inspector@sha256:" + "0" * 64
            for stage in ("test", "online"):
                project = "memoia-inspector-" + stage
                config = step(["docker", "compose", "-p", project, "-f", "deploy/compose.yml",
                               "config", "--format", "json"], source, True)
                if json.loads(config)["name"] != project:
                    raise ValueError("COMPOSE_STAGE_MISMATCH")
            started = True
            step(["docker", "run", "--name", container, "--label", "jianify.local-ci=true",
                  "--network", "none", "-v", f"{source}:/work:ro", "-w", "/work",
                  "python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e",
                  "bash", "tests/deploy-inspector.test.sh"], source)
            print("Inspector 本地 CI 全部通过；未发布镜像或连接业务 API。", flush=True)
    finally:
        if started:
            run(["docker", "rm", "-f", "-v", container], env=local_env(), timeout=15)


def cancel(*_):
    raise KeyboardInterrupt()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    try:
        if len(sys.argv) != 1:
            raise ValueError("Usage: python3 scripts/verify_local.py")
        verify()
    except (ValueError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(str(error) or "LOCAL_CI_CANCELLED", file=sys.stderr)
        sys.exit(1)
