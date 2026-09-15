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
python3 - "$task_dir/override.json" "$task_root" <<'PY'
import json,sys,os
from pathlib import Path
data=dict(type='bind',source=os.environ['KTV_DATA_DIR'],target='/data')
main=dict(image=os.environ['KTV_IMAGE'],
    environment=dict(PORT=os.environ['KTV_PORT'],ADMIN_PASSWORD=os.environ['ADMIN_PASSWORD'],
        KTV_DISCOVERY_ENABLED='0',KTV_TV_DISCOVERY_ENABLED='0',KTV_LOCAL_ONLY='1'),
    volumes=[data,
        dict(type='bind',source=os.environ['KTV_MEDIA_DIR'],target='/media'),
        dict(type='bind',source=os.environ['KTV_DOWNLOAD_DIR'],target='/download'),
        dict(type='bind',source=str(Path(sys.argv[2])/'scripts'),target='/app/scripts',read_only=True)])
services=dict(ktv=main,**{'separator-cpu':dict(volumes=[data])})
if os.uname().machine != 'aarch64':
    services['separator-npu']=dict(volumes=[data])
Path(sys.argv[1]).write_text(json.dumps(dict(services=services)))
PY
task_dc() { docker compose --env-file "$task_dir/empty.env" -p "$task_project" -f "$task_compose" -f "$task_dir/override.json" "$@"; }
task_cleanup() {
  task_dc logs --tail 100 || true
  task_dc down --volumes --remove-orphans || true
  # Containers created root-owned files inside this exact mktemp directory.
  docker run --rm --entrypoint sh -v "$task_dir:/task" "$KTV_IMAGE" -c 'rm -rf -- /task/data /task/media /task/download'
  rm -rf -- "$task_dir"
}
trap task_cleanup EXIT
task_dc config -q
task_dc up -d --wait --wait-timeout 180
test -z "$(docker network ls -q --filter "label=com.docker.compose.project=$task_project")"
task_dc exec -T ktv node scripts/check-compose-runtime.mjs
task_cpu_id=$(task_dc ps -q separator-cpu)
task_npu_id=$(task_dc ps -q separator-npu 2>/dev/null || true)
task_key_hash=$(task_dc exec -T ktv sha256sum /data/separation/internal.key)
task_dc up -d --no-deps --force-recreate --wait --wait-timeout 90 ktv
test "$(task_dc ps -q separator-cpu)" = "$task_cpu_id"
test "$(task_dc ps -q separator-npu 2>/dev/null || true)" = "$task_npu_id"
test "$(task_dc exec -T ktv sha256sum /data/separation/internal.key)" = "$task_key_hash"
task_dc exec -T ktv node scripts/check-compose-runtime.mjs --health-only
echo 'Compose CPU/NPU wiring, private authentication, actual separation and main-only update passed'
