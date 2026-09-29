#!/usr/bin/env bash
set -euo pipefail

mode=${1:?Expected init-config, init, deploy, restore-api, or clear-pending}
root=/opt/memoia-inspector
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ "$EUID" == 0 ]] || { echo 'Run via sudo -n' >&2; exit 2; }
[[ "$mode" == init-config || "$mode" == init || "$mode" == deploy || "$mode" == restore-api || "$mode" == clear-pending ]] || exit 2
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
  echo 'Inspector templates are ready. Fill /opt/memoia-inspector/.env before init.'
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
if [[ -e "$state_dir/pending" ]]; then
  echo 'A previous deployment has an unresolved result; investigate before retrying' >&2; exit 1
fi
if [[ "$mode" == deploy ]]; then
  read -r current_run _ < "$state_dir/current"
  (( run_id > current_run )) || { echo 'Stale workflow cannot replace a newer deployment' >&2; exit 1; }
fi
if [[ "$mode" == restore-api ]]; then
  [[ -f "$state_dir/previous" ]] || { echo 'No previous accepted image' >&2; exit 1; }
  read -r _ previous_sha previous_image _ < "$state_dir/previous"
  [[ "$image" == "$previous_image" && "$source_sha" == "$previous_sha" ]] || {
    echo 'Restore target is not the previous accepted image' >&2; exit 1;
  }
fi

export INSPECTOR_IMAGE="$image"
compose=(docker compose -f "$root/compose.yml")
"${compose[@]}" config --quiet
anonymous_config=$(mktemp -d)
trap 'rm -rf -- "$anonymous_config"' EXIT
DOCKER_CONFIG="$anonymous_config" docker pull "$image"
[[ "$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$source_sha" ]] || {
  echo 'Image revision does not match candidate source' >&2; exit 1;
}
umask 077
printf '%s %s %s\n' "$run_id" "$source_sha" "$image" > "$state_dir/pending"
"${compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 120 inspector
container=$("${compose[@]}" ps -q inspector)
[[ -n "$container" && "$(docker inspect --format '{{.Config.Image}}' "$container")" == "$image" ]] || exit 1
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] || exit 1
curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:3001/settings >/dev/null
if [[ -f "$state_dir/current" ]]; then
  cp "$state_dir/current" "$state_dir/previous"
fi
config_sha=$(sha256sum "$root/.env" | cut -d' ' -f1)
high_water=$run_id
if [[ -f "$state_dir/previous" ]]; then
  read -r previous_run _ < "$state_dir/previous"
  (( previous_run <= high_water )) || high_water=$previous_run
fi
printf '%s %s %s %s\n' "$high_water" "$source_sha" "$image" "$config_sha" > "$state_dir/current"
rm "$state_dir/pending"
echo "Inspector accepted: source=$source_sha image=$image"
