#!/bin/sh
# Isolated CI check of the actual shipped Compose, without LAN discovery.
set -eu
task_root=$(pwd)
task_dir=$(mktemp -d)
task_project="ktv-check-$(basename "$task_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
task_compose=docker-compose.yaml
if [ "$(uname -m)" = aarch64 ]; then task_compose=docker-compose.arm64.yaml; fi
export KTV_IMAGE="${KTV_TEST_IMAGE:-haohaochang:test}"
export KTV_DATA_DIR="$task_dir/data"
export KTV_MEDIA_DIR="$task_dir/media"
export KTV_DOWNLOAD_DIR="$task_dir/download"
export KTV_PORT=43126
export ADMIN_PASSWORD=ci-compose-fixture-password
mkdir -p "$KTV_DATA_DIR" "$KTV_MEDIA_DIR" "$KTV_DOWNLOAD_DIR"
touch "$task_dir/empty.env"
docker compose --env-file "$task_dir/empty.env" -f "$task_compose" config --format json > "$task_dir/resolved.json"
python3 - "$task_dir/resolved.json" "$task_root" <<'PY'
import json,sys
from pathlib import Path
file=Path(sys.argv[1]); config=json.loads(file.read_text())
main=config['services']['ktv']
main['environment'].update(KTV_DISCOVERY_ENABLED='0',KTV_TV_DISCOVERY_ENABLED='0',KTV_LOCAL_ONLY='1')
main['volumes'].append(dict(type='bind',source=str(Path(sys.argv[2])/'scripts'),target='/app/scripts',read_only=True))
for service in config['services'].values():
    if isinstance(service.get('command'),list):
        service['command']=[part.replace('$','$$') for part in service['command']]
file.write_text(json.dumps(config))
PY
task_dc() { docker compose --env-file "$task_dir/empty.env" -p "$task_project" -f "$task_dir/resolved.json" "$@"; }
task_cleanup() {
  task_dc logs --tail 100 || true
  task_dc down --volumes --remove-orphans || true
  # mktemp created this exact task-owned directory.
  rm -rf -- "$task_dir"
}
trap task_cleanup EXIT
task_dc up -d --wait --wait-timeout 180
task_dc exec -T ktv node scripts/check-compose-runtime.mjs
task_cpu_id=$(task_dc ps -q separator-cpu)
task_key_hash=$(task_dc exec -T ktv sha256sum /data/separation/internal.key)
task_dc up -d --no-deps --force-recreate --wait --wait-timeout 90 ktv
test "$(task_dc ps -q separator-cpu)" = "$task_cpu_id"
test "$(task_dc exec -T ktv sha256sum /data/separation/internal.key)" = "$task_key_hash"
task_dc exec -T ktv node scripts/check-compose-runtime.mjs --health-only
echo 'Compose CPU/NPU wiring, private authentication, actual separation and main-only update passed'
