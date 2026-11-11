#!/usr/bin/env bash
# Invoked as the dedicated app user; never changes another PM2 process.
set -euo pipefail
umask 077
wk_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
wk_config="$HOME/.config/wortkarten"
read -r wk_node < "$wk_config/node22.path"
[[ "$wk_node" = /* && -x "$wk_node" ]] || { echo 'Dedicated Node path is missing' >&2; exit 1; }
export PATH="$HOME/.local/bin:$(dirname -- "$wk_node"):/usr/local/bin:/usr/bin:/bin"
cd -- "$wk_repo"
exec "$wk_node" --env-file=.env --env-file="$wk_config/backup.env" scripts/backup-offsite.cjs
