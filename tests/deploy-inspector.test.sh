#!/usr/bin/env bash
set -euo pipefail

[[ "$EUID" == 0 ]] || { echo 'Run this isolated test as root inside a container' >&2; exit 2; }
workspace=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/source" "$fixture/state"
cp "$workspace/deploy/compose.yml" "$workspace/deploy/runtime.env.example" "$fixture/source/"
sed "s|root=/opt/memoia-inspector|root=$fixture/service|" "$workspace/deploy/deploy-inspector.sh" > "$fixture/source/deploy-inspector.sh"

export MOCK_STATE="$fixture/state"
A_SHA="$(printf 'a%.0s' {1..40})"
B_SHA="$(printf 'b%.0s' {1..40})"
A_IMAGE="ghcr.io/jianify/memoia-inspector@sha256:$(printf 'a%.0s' {1..64})"
B_IMAGE="ghcr.io/jianify/memoia-inspector@sha256:$(printf 'b%.0s' {1..64})"
export A_SHA B_SHA A_IMAGE B_IMAGE
export PATH="$fixture/bin:$PATH"

cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == compose ]]; then
  shift
  [[ "$1" == -f ]] && shift 2
  case "$1" in
    config) exit 0 ;;
    ps)
      if [[ -f "$MOCK_STATE/image" && ( "$2" == -aq || "$(cat "$MOCK_STATE/status")" == running ) ]]; then
        echo inspector-container
      fi
      ;;
    up)
      printf '%s\n' "$INSPECTOR_IMAGE" > "$MOCK_STATE/image"
      printf 'running\n' > "$MOCK_STATE/status"
      if [[ "$INSPECTOR_IMAGE" == "${MOCK_FAIL_IMAGE:-}" ]]; then
        printf 'unhealthy\n' > "$MOCK_STATE/health"
        exit 1
      fi
      printf 'healthy\n' > "$MOCK_STATE/health"
      ;;
    stop) printf 'stopped\n' > "$MOCK_STATE/status" ;;
    *) exit 2 ;;
  esac
elif [[ "$1" == pull ]]; then
  printf '%s\n' "$2" >> "$MOCK_STATE/pulls"
  exit 0
elif [[ "$1" == image && "$2" == inspect ]]; then
  case "$3" in
    "$A_IMAGE") printf '%s\n' "$A_SHA" ;;
    "$B_IMAGE") printf '%s\n' "$B_SHA" ;;
    *) exit 2 ;;
  esac
elif [[ "$1" == inspect ]]; then
  case "$3" in
    '{{.Config.Image}}') cat "$MOCK_STATE/image" ;;
    '{{.State.Health.Status}}') cat "$MOCK_STATE/health" ;;
    *) exit 2 ;;
  esac
else
  exit 2
fi
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
[[ "$(cat "$MOCK_STATE/image")" != "${MOCK_FAIL_CURL_IMAGE:-}" ]]
MOCK
chmod 700 "$fixture/bin/docker" "$fixture/bin/curl"

deploy() { bash "$fixture/source/deploy-inspector.sh" "$@"; }
expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo 'Expected deployment failure' >&2
    exit 1
  fi
}
assert_current() {
  [[ "$(cut -d' ' -f1 "$fixture/service/.deploy/current")" == "$1" ]]
  [[ "$(cut -d' ' -f3 "$fixture/service/.deploy/current")" == "$2" ]]
}

deploy init-config >/dev/null
[[ "$(stat -c '%u:%g:%a' "$fixture/service/.env")" == 0:0:600 ]]
grep -Fxq 'OPENAI_API_KEY=' "$fixture/service/.env"
expect_failure deploy install-runtime-env <<< 'OPENAI_API_KEY=test'

export MOCK_FAIL_IMAGE="$B_IMAGE"
expect_failure deploy apply "$B_IMAGE" "$B_SHA" 100
[[ ! -e "$fixture/service/.deploy/current" && -f "$fixture/service/.deploy/pending" ]]
[[ "$(cat "$MOCK_STATE/status")" == stopped ]]
deploy clear-pending "$B_SHA" >/dev/null

unset MOCK_FAIL_IMAGE
deploy apply "$A_IMAGE" "$A_SHA" 110 >/dev/null
assert_current 110 "$A_IMAGE"
[[ "$(grep -c '^OPENAI_API_KEY=$' "$fixture/service/.env")" == 1 ]]
printf 'OPENAI_API_KEY=rotated\nOPENAI_BASE_URL=https://example.test/v1\nOPENAI_MODEL=test-model\n' | expect_failure deploy install-runtime-env
cp "$fixture/service/.env" "$fixture/accepted.env"
printf 'OPENAI_MODEL=out-of-band\n' >> "$fixture/service/.env"
expect_failure deploy apply "$B_IMAGE" "$B_SHA" 190
assert_current 110 "$A_IMAGE"
cp "$fixture/accepted.env" "$fixture/service/.env"

export MOCK_FAIL_IMAGE="$B_IMAGE"
expect_failure deploy apply "$B_IMAGE" "$B_SHA" 200
assert_current 110 "$A_IMAGE"
[[ "$(cat "$MOCK_STATE/status")" == stopped ]]
expect_failure deploy deploy "$B_IMAGE" "$B_SHA" 201
expect_failure deploy restore-api "$B_IMAGE" "$B_SHA" 200 "$B_SHA"
expect_failure deploy restore-api "$A_IMAGE" "$A_SHA" 201 "$B_SHA"
pulls_before_restore=$(wc -l < "$MOCK_STATE/pulls")
deploy restore-api "$A_IMAGE" "$A_SHA" 200 "$B_SHA" >/dev/null
[[ "$(wc -l < "$MOCK_STATE/pulls")" == "$pulls_before_restore" ]]
assert_current 200 "$A_IMAGE"
[[ ! -e "$fixture/service/.deploy/pending" ]]
[[ -f "$fixture/service/.deploy/recovered-200-$B_SHA" ]]
expect_failure deploy deploy "$B_IMAGE" "$B_SHA" 199

unset MOCK_FAIL_IMAGE
export MOCK_FAIL_CURL_IMAGE="$B_IMAGE"
expect_failure deploy deploy "$B_IMAGE" "$B_SHA" 250
assert_current 200 "$A_IMAGE"
[[ "$(cat "$MOCK_STATE/status")" == stopped ]]
deploy restore-api "$A_IMAGE" "$A_SHA" 250 "$B_SHA" >/dev/null
assert_current 250 "$A_IMAGE"
unset MOCK_FAIL_CURL_IMAGE

deploy apply "$B_IMAGE" "$B_SHA" 300 >/dev/null
assert_current 300 "$B_IMAGE"
[[ "$(cut -d' ' -f3 "$fixture/service/.deploy/previous")" == "$A_IMAGE" ]]
expect_failure deploy restore-api "$A_IMAGE" "$A_SHA" 300
deploy restore-api "$A_IMAGE" "$A_SHA" 301 >/dev/null
assert_current 301 "$A_IMAGE"
[[ "$(cut -d' ' -f3 "$fixture/service/.deploy/previous")" == "$B_IMAGE" ]]

printf '%s\n' "$B_IMAGE" > "$MOCK_STATE/image"
expect_failure deploy deploy "$B_IMAGE" "$B_SHA" 400

sed "s|root=$fixture/service|root=$fixture/optional-service|" "$fixture/source/deploy-inspector.sh" > "$fixture/source/deploy-inspector-optional.sh"
bash "$fixture/source/deploy-inspector-optional.sh" init-config >/dev/null
printf 'OPENAI_API_KEY=test\nOPENAI_BASE_URL=https://example.test/v1\nOPENAI_MODEL=test-model\n' |
  bash "$fixture/source/deploy-inspector-optional.sh" install-runtime-env >/dev/null
grep -Fxq 'OPENAI_API_KEY=test' "$fixture/optional-service/.env"
echo 'Inspector deployment transitions passed'
