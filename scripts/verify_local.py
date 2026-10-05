"""Inspector 本地与远端 Verify 共用入口；临时源码，不读取业务 .env。"""
import argparse
from contextlib import contextmanager
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


def tools_required(mode, base=None):
    if mode == "publish":
        return False
    if mode == "full" or not base or base == "0" * 40:
        return True
    if len(base) != 40 or any(c not in "0123456789abcdef" for c in base):
        raise ValueError("CI_BASE_INVALID")
    try:
        changed = run(["git", "diff", "--name-only", "-z", base, "HEAD"], cwd=ROOT, capture=True, timeout=30).split("\0")
    except subprocess.CalledProcessError:
        return True
    return any(name.startswith(("scripts/", "deploy/", ".githooks/", ".github/"))
               or name in ("tests/deploy-inspector.test.sh", "tests/workflow-contract.test.ts", "Dockerfile", "package.json", "pnpm-lock.yaml")
               for name in changed)


@contextmanager
def source_tree(checkout, temporary):
    if checkout:
        if run(["git", "status", "--porcelain"], cwd=ROOT, capture=True, timeout=30):
            raise ValueError("CI_CHECKOUT_MUST_BE_CLEAN")
        yield ROOT
        return
    source = Path(temporary) / "source"
    source.mkdir()
    snapshot(source)
    yield source


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


def verify(mode="full", base=None, checkout=False):
    tools = tools_required(mode, base)
    build = mode in ("full", "pr")
    env = local_env()
    commands = ["pnpm", "node"] + (["shellcheck"] if tools else []) + (["docker"] if build or tools else [])
    for command in commands:
        if not shutil.which(command):
            raise ValueError("LOCAL_CI_DEPENDENCY_MISSING: " + command)
    if "docker" in commands:
        endpoint = run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env=env, capture=True, timeout=15)
        if not endpoint.startswith(("unix://", "npipe://")):
            raise ValueError("LOCAL_DOCKER_REQUIRED")
    deadline = time.monotonic() + 1800
    container = "inspector-ci-" + uuid.uuid4().hex
    started = False
    image_started = False

    def step(command, cwd, capture=False):
        print("本地 CI：" + " ".join(command), flush=True)
        return run(command, cwd=cwd, env=env, timeout=deadline - time.monotonic(), capture=capture)

    try:
        with tempfile.TemporaryDirectory(prefix="inspector-local-ci-") as temporary, source_tree(checkout, temporary) as source:
            env.update(NPM_CONFIG_USERCONFIG="/dev/null", NPM_CONFIG_GLOBALCONFIG="/dev/null")
            step(["pnpm", "install", "--frozen-lockfile"], source)
            if tools:
                step([sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-v"], source)
            # 每种模式复用业务检查，发布生产构建只由 Docker 完成。
            for command in ("check:sdk", "typecheck", "lint"):
                step(["pnpm", command], source)
            tests = ["pnpm", "test"] + ([] if tools else ["--exclude", "tests/workflow-contract.test.ts"])
            if mode == "quick":
                env["NODE_OPTIONS"] = "--import=" + str(source / "scripts/offline-node.mjs")
            step(tests, source)
            env.pop("NODE_OPTIONS", None)
            if mode != "quick":
                step(["pnpm", "audit", "--prod", "--audit-level", "high", "--registry=https://registry.npmjs.org"], source)
            if build:
                image_started = True
                step(["docker", "build", "--tag", container, "--build-arg", "SOURCE_REVISION=local-verification", "."], source)
            if tools:
                started = True
                deployment_fixtures(step, source, env, container)
    finally:
        cleanup_owned(container, started, image_started)
    print(f"Inspector {mode} CI 全部通过；未发布镜像或连接业务 API。", flush=True)


def cleanup_owned(name, container, image):
    # 创建命令失败不一定产生资源；先查本批精确名字，清理失败不能报告成功。
    errors = []
    resources = []
    if container:
        resources.append((["docker", "container", "ls", "-aq", "--filter", f"name=^/{name}$"],
                          ["docker", "rm", "-f", "-v", name]))
    if image:
        resources.append((["docker", "image", "ls", "-q", "--filter", f"reference={name}"],
                          ["docker", "image", "rm", name]))
    for inspect, remove in resources:
        try:
            if run(inspect, env=local_env(), capture=True, timeout=15):
                run(remove, env=local_env(), timeout=15)
        except (OSError, subprocess.SubprocessError) as error:
            errors.append(str(error))
    if errors:
        raise ValueError("LOCAL_CI_CLEANUP_FAILED: " + "; ".join(errors))


def deployment_fixtures(step, source, env, container):
    step(["shellcheck", *map(str, sorted((source / "deploy").glob("*.sh"))),
          "tests/deploy-inspector.test.sh", ".githooks/pre-push"], source)
    env["INSPECTOR_IMAGE"] = "ghcr.io/jianify-llc/memoia-inspector@sha256:" + "0" * 64
    with tempfile.TemporaryDirectory(prefix="inspector-compose-fixture-") as temporary:
        fixture = Path(temporary)
        shutil.copy2(source / "deploy/compose.yml", fixture / "compose.yml")
        shutil.copy2(source / "deploy/runtime.env.example", fixture / ".env")
        for stage in ("test", "online"):
            project = "memoia-inspector-" + stage
            config = step(["docker", "compose", "-p", project, "-f", "compose.yml", "config", "--format", "json"], fixture, True)
            if json.loads(config)["name"] != project:
                raise ValueError("COMPOSE_STAGE_MISMATCH")
    step(["docker", "run", "--name", container, "--label", "jianify.local-ci=true",
          "--network", "none", "-v", f"{source}:/work:ro", "-w", "/work",
          "python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e",
          "bash", "tests/deploy-inspector.test.sh"], source)


def cancel(*_):
    raise KeyboardInterrupt()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--mode", choices=("quick", "full", "publish", "pr"), default="full")
        parser.add_argument("--base")
        parser.add_argument("--checkout", action="store_true")
        args = parser.parse_args()
        verify(args.mode, args.base, args.checkout)
    except (ValueError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(str(error) or "LOCAL_CI_CANCELLED", file=sys.stderr)
        sys.exit(1)
