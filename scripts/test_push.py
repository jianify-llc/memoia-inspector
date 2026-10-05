"""Test 推送前检查准确源码；长检查先于 Git 连接，不缓存或复用证明。"""
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PROOF = "JIANIFY_TEST_LOCAL_CI_PROOF"
ZERO = "0" * 40
CI_TIMEOUT = 1800


def local_env():
    # 运行工具所需环境；业务、数据库、模型及平台凭据不传给本地 CI。
    names = ("PATH", "HOME", "PNPM_HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL")
    result = dict({key: os.environ[key] for key in names if key in os.environ},
                  CI="true", NEXT_TELEMETRY_DISABLED="1", PYTHONDONTWRITEBYTECODE="1")
    # 依赖下载仍需本机网络代理；只传不含认证信息的传输配置。
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        value = os.environ.get(name)
        if not value:
            continue
        proxy = urlsplit(value)
        if not proxy.hostname or proxy.username or proxy.password or proxy.query or proxy.fragment:
            raise ValueError("LOCAL_PROXY_AUTH_FORBIDDEN")
        result[name] = value
    for name in ("NO_PROXY", "no_proxy"):
        if name in os.environ:
            result[name] = os.environ[name]
    return result


def run(command, cwd=ROOT, env=None, timeout=1200, capture=False, grace=5):
    if timeout <= 0:
        raise subprocess.TimeoutExpired(command, timeout)
    child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                             stdout=subprocess.PIPE if capture else None,
                             text=True)
    try:
        output, _ = child.communicate(timeout=max(0.1, timeout))
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, command)
        return (output or "").strip()
    finally:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if child.poll() is None:
            try:
                child.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        # 父进程已退出也不能留下仍持有 stdout 或忽略 TERM 的后台子进程。
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def git(*args):
    return run(["git", *args], timeout=30, capture=True)


def clean_head():
    if git("status", "--porcelain"):
        raise ValueError("TEST_PUSH_DIRTY_WORKTREE: 使用已提交的干净 worktree。")
    return git("rev-parse", "HEAD")


def check(input_text):
    for line in input_text.splitlines():
        fields = line.split()
        if len(fields) != 4:
            raise ValueError("PUSH_REF_INPUT_INVALID")
        _, sha, destination, base = fields
        if destination != "refs/heads/test":
            continue
        if not all(re.fullmatch(r"[a-f0-9]{40}", value) for value in (sha, base)):
            raise ValueError("PUSH_REF_INPUT_INVALID")
        if sha == ZERO:
            raise ValueError("TEST_BRANCH_DELETION_FORBIDDEN")
        if clean_head() != sha:
            raise ValueError("TEST_PUSH_HEAD_MISMATCH")
        if os.environ.get(PROOF) != f"{sha}:{base}":
            raise ValueError("TEST_PUSH_REQUIRES_LOCAL_CI: 运行 python3 scripts/test_push.py push。")
        if base != ZERO:
            git("merge-base", "--is-ancestor", base, sha)
        print("本次本地 CI 已通过，允许推送 Test：" + sha)


def install():
    configured = subprocess.run(["git", "config", "--get", "core.hooksPath"],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
    if configured.returncode not in (0, 1):
        raise ValueError("HOOK_CONFIG_READ_FAILED")
    value = configured.stdout.strip()
    if value and value != ".githooks":
        raise ValueError("EXISTING_HOOK_MANAGER: 不覆盖已有 hooksPath，请人工整合。")
    if not value:
        hooks = ROOT / git("rev-parse", "--git-path", "hooks")
        if hooks.is_dir() and any(file.is_file() and not file.name.endswith(".sample") for file in hooks.iterdir()):
            raise ValueError("EXISTING_HOOKS: 不隐藏已有 hooks，请人工整合。")
    (ROOT / ".githooks/pre-push").chmod(0o755)
    git("config", "--local", "core.hooksPath", ".githooks")
    print("已安装 Test 推送门禁。")


def push():
    if git("config", "--get", "core.hooksPath") != ".githooks":
        raise ValueError("HOOK_NOT_INSTALLED: 先运行 python3 scripts/test_push.py install。")
    if not os.access(ROOT / ".githooks/pre-push", os.X_OK):
        raise ValueError("HOOK_NOT_EXECUTABLE")
    sha = clean_head()
    remote = git("ls-remote", "origin", "refs/heads/test").split()
    base = remote[0] if remote else ZERO
    if not re.fullmatch(r"[a-f0-9]{40}", base):
        raise ValueError("TEST_PUSH_BASE_INVALID")
    if base != ZERO:
        git("fetch", "--no-tags", "origin", "test")
        git("merge-base", "--is-ancestor", base, sha)
    run([sys.executable, "scripts/verify_local.py", "--mode", "quick", "--base", base], env=local_env(),
        timeout=CI_TIMEOUT + 30, grace=60)
    if clean_head() != sha:
        raise ValueError("TEST_PUSH_SOURCE_CHANGED")
    run(["git", "push", "origin", "HEAD:refs/heads/test"],
        env=dict(os.environ, **{PROOF: f"{sha}:{base}"}), timeout=60)


def cancel(*_):
    raise KeyboardInterrupt()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    try:
        if sys.argv[1:] == ["check"]:
            check(sys.stdin.read())
        elif sys.argv[1:] == ["install"]:
            install()
        elif sys.argv[1:] == ["push"]:
            push()
        else:
            raise ValueError("Usage: python3 scripts/test_push.py install|push|check")
    except (ValueError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(str(error) or "TEST_PUSH_CANCELLED", file=sys.stderr)
        sys.exit(1)
