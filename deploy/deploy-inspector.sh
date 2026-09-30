#!/usr/bin/env bash
set -euo pipefail

mode=${1:?Expected init-config, install-runtime-env, apply, init, deploy, restore-api, or clear-pending}
root=/opt/memoia-inspector
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ "$EUID" == 0 ]] || { echo 'Run via sudo -n' >&2; exit 2; }
[[ "$mode" == init-config || "$mode" == install-runtime-env || "$mode" == apply || "$mode" == init || "$mode" == deploy || "$mode" == restore-api || "$mode" == clear-pending ]] || exit 2
exec 9>/run/lock/memoia-inspector-deploy.lock
flock -x 9

if [[ "$mode" == init-config ]]; then
  [[ ! -L "$root" && ( ! -e "$root" || -d "$root" ) ]] || exit 2
  [[ ! -L "$root/.deploy" && ( ! -e "$root/.deploy" || -d "$root/.deploy" ) ]] || exit 2
  install -d -o root -g root -m 700 "$root" "$root/.deploy" "$root/.deploy/candidates"
  if [[ ! -e "$root/.env" ]]; then
    install -o root -g root -m 600 "$script_dir/runtime.env.example" "$root/.env"
  fi
  if [[ ! -e "$root/compose.yml" ]]; then
    install -o root -g root -m 644 "$script_dir/compose.yml" "$root/compose.yml"
  fi
  echo 'Inspector deployment directories are ready. Install runtime config from the test Environment before init.'
  exit 0
fi
if [[ "$mode" == install-runtime-env ]]; then
  [[ -d "$root" && ! -L "$root" && "$(stat -c '%u:%g:%a' "$root")" == 0:0:700 ]] || exit 2
  [[ -d "$root/.deploy" && ! -L "$root/.deploy" && "$(stat -c '%u:%g:%a' "$root/.deploy")" == 0:0:700 ]] || exit 2
  [[ ! -L "$root/.env" ]] || exit 2
  if [[ -e "$root/.env" ]]; then
    [[ -f "$root/.env" && "$(stat -c '%u:%g:%a' "$root/.env")" == 0:0:600 ]] || exit 2
  fi
  runtime_tmp=$(mktemp "$root/.deploy/runtime-env.XXXXXX")
  trap 'rm -f -- "$runtime_tmp"' EXIT
  tee "$runtime_tmp" >/dev/null
  python3 - "$runtime_tmp" <<'PY'
from pathlib import Path
import re
import sys

expected = {"OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"}
lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
values = {}
for line in lines:
    key, separator, value = line.partition("=")
    if (not separator or key not in expected or key in values or not value
            or re.search(r"[\s\x00$#'\"\\]", value)):
        sys.exit("Invalid Inspector runtime configuration")
    values[key] = value
if set(values) != expected:
    sys.exit("Incomplete Inspector runtime configuration")
PY
  if [[ -f "$root/.env" ]] && cmp -s "$runtime_tmp" "$root/.env"; then
    echo 'Inspector runtime config already matches the test Environment.'
    exit 0
  fi
  [[ ! -f "$root/.deploy/current" ]] || {
    echo 'Runtime config changed after acceptance; rotate it as separate maintenance' >&2; exit 1;
  }
  chown root:root "$runtime_tmp"
  chmod 600 "$runtime_tmp"
  mv -f -- "$runtime_tmp" "$root/.env"
  echo 'Inspector runtime config installed from the test Environment.'
  exit 0
fi
if [[ "$mode" == clear-pending ]]; then
  [[ -f "$root/.deploy/pending" && "${2:-}" == "$(cut -d' ' -f2 "$root/.deploy/pending")" ]] || {
    echo 'Provide the exact pending source SHA after manual investigation' >&2; exit 2;
  }
  mv "$root/.deploy/pending" "$root/.deploy/rejected-$(date -u +%Y%m%dT%H%M%SZ)"
  echo 'Pending candidate archived; confirm current service state before a new deployment.'
  exit 0
fi

if [[ "$mode" == apply ]]; then
  if [[ -f "$root/.deploy/current" ]]; then mode=deploy; else mode=init; fi
fi

image=${2:?Expected a manifest-addressed Inspector image}
source_sha=${3:?Expected source commit SHA}
run_id=${4:?Expected GitHub Actions run ID}
[[ "$image" =~ ^ghcr\.io/jianify/memoia-inspector@sha256:[0-9a-f]{64}$ ]] || exit 2
[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]+$ ]] || exit 2
[[ -d "$root" && ! -L "$root" && "$(stat -c '%u:%g:%a' "$root")" == 0:0:700 ]] || exit 2
[[ -d "$root/.deploy" && ! -L "$root/.deploy" && "$(stat -c '%u:%g:%a' "$root/.deploy")" == 0:0:700 ]] || exit 2
[[ -f "$root/.env" && ! -L "$root/.env" && "$(stat -c '%u:%g:%a' "$root/.env")" == 0:0:600 ]] || exit 2
[[ -f "$root/compose.yml" && ! -L "$root/compose.yml" && "$(stat -c '%u:%g:%a' "$root/compose.yml")" == 0:0:644 ]] || exit 2
[[ "$(sha256sum "$root/compose.yml" | cut -d' ' -f1)" == "$(sha256sum "$script_dir/compose.yml" | cut -d' ' -f1)" ]] || {
  echo 'Compose changed; review it as separate host maintenance before an API update' >&2; exit 1;
}

# Parse only the three required names. Never source or print a secret dotenv file.
python3 - "$root/.env" <<'PY'
import sys
values = {}
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    key, sep, value = line.partition("=")
    if sep:
        values[key] = value.strip().strip('"').strip("'")
if not all(values.get(key) for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL")):
    sys.exit("Inspector model configuration is incomplete")
PY

state_dir="$root/.deploy"
if [[ "$mode" == init && -e "$state_dir/current" ]]; then
  echo 'Already initialized' >&2; exit 1
fi
if [[ "$mode" != init && ! -f "$state_dir/current" ]]; then
  echo 'Initial deployment has not been accepted' >&2; exit 1
fi
recover_pending=false
if [[ -e "$state_dir/pending" ]]; then
  [[ "$mode" == restore-api ]] || {
    echo 'A previous deployment has an unresolved result; investigate before retrying' >&2; exit 1;
  }
  recover_pending=true
  read -r pending_run pending_sha _ < "$state_dir/pending"
  [[ "${5:-}" == "$pending_sha" ]] || {
    echo 'Provide the exact pending source SHA to recover the last accepted image' >&2; exit 2;
  }
  [[ "$run_id" == "$pending_run" ]] || {
    echo 'Recovery run ID must match the pending deployment' >&2; exit 2;
  }
fi
if [[ "$mode" == deploy ]]; then
  read -r current_run _ < "$state_dir/current"
  (( run_id > current_run )) || { echo 'Stale workflow cannot replace a newer deployment' >&2; exit 1; }
fi
if [[ "$mode" == restore-api ]]; then
  restore_record="$state_dir/previous"
  [[ "$recover_pending" == false ]] || restore_record="$state_dir/current"
  [[ -f "$restore_record" ]] || { echo 'No accepted image to restore' >&2; exit 1; }
  if [[ "$recover_pending" == false ]]; then
    read -r current_run _ < "$state_dir/current"
    (( run_id > current_run )) || { echo 'Restore run ID must be newer than the accepted deployment' >&2; exit 1; }
  fi
  read -r _ restore_sha restore_image _ < "$restore_record"
  [[ "$image" == "$restore_image" && "$source_sha" == "$restore_sha" ]] || {
    echo 'Restore target does not match the accepted image' >&2; exit 1;
  }
fi

export INSPECTOR_IMAGE="$image"
compose=(docker compose -f "$root/compose.yml")
"${compose[@]}" config --quiet
if [[ "$mode" == deploy ]]; then
  read -r _ _ current_image accepted_config_sha < "$state_dir/current"
  [[ "$(sha256sum "$root/.env" | cut -d' ' -f1)" == "$accepted_config_sha" ]] || {
    echo 'Runtime config differs from the accepted deployment; review it separately' >&2; exit 1;
  }
  current_container=$("${compose[@]}" ps -q inspector)
  [[ -n "$current_container" && "$(docker inspect --format '{{.Config.Image}}' "$current_container")" == "$current_image" ]] || {
    echo 'Running image differs from the last accepted image; investigate before updating' >&2; exit 1;
  }
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$current_container")" == healthy ]] || {
    echo 'Current Inspector is unhealthy; use explicit recovery' >&2; exit 1;
  }
fi
anonymous_config=$(mktemp -d)
activation_started=false
acceptance_complete=false
cleanup() {
  result=$?
  if (( result != 0 )) && [[ "$activation_started" == true && "$acceptance_complete" == false ]]; then
    candidate_container=$("${compose[@]}" ps -aq inspector 2>/dev/null || true)
    if [[ -n "$candidate_container" && "$(docker inspect --format '{{.Config.Image}}' "$candidate_container" 2>/dev/null || true)" == "$image" ]]; then
      "${compose[@]}" stop inspector >/dev/null || true
    fi
  fi
  rm -rf -- "$anonymous_config"
}
trap cleanup EXIT
if [[ "$mode" != restore-api ]] || ! docker image inspect "$image" >/dev/null 2>&1; then
  DOCKER_CONFIG="$anonymous_config" docker pull "$image"
fi
[[ "$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$source_sha" ]] || {
  echo 'Image revision does not match candidate source' >&2; exit 1;
}
umask 077
if [[ "$recover_pending" == false ]]; then
  printf '%s %s %s\n' "$run_id" "$source_sha" "$image" > "$state_dir/pending"
fi
activation_started=true
"${compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 120 inspector
container=$("${compose[@]}" ps -q inspector)
[[ -n "$container" && "$(docker inspect --format '{{.Config.Image}}' "$container")" == "$image" ]] || exit 1
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] || exit 1
curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:3001/settings >/dev/null
if [[ "$recover_pending" == false && -f "$state_dir/current" ]]; then
  cp "$state_dir/current" "$state_dir/previous"
fi
config_sha=$(sha256sum "$root/.env" | cut -d' ' -f1)
high_water=$run_id
if [[ -f "$state_dir/current" ]]; then
  read -r current_run _ < "$state_dir/current"
  (( current_run <= high_water )) || high_water=$current_run
fi
if [[ "$recover_pending" == true ]]; then
  (( pending_run <= high_water )) || high_water=$pending_run
fi
printf '%s %s %s %s\n' "$high_water" "$source_sha" "$image" "$config_sha" > "$state_dir/current"
acceptance_complete=true
if [[ "$recover_pending" == true ]]; then
  mv "$state_dir/pending" "$state_dir/recovered-$pending_run-$pending_sha"
else
  rm "$state_dir/pending"
fi
echo "Inspector accepted: source=$source_sha image=$image"
