#!/usr/bin/env bash
# Installs ONLY Wortkarten backup units; does NOT start/enable them or change PM2.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Use sudo with explicit app user and checkout path' >&2; exit 1; }
wk_user=${WORTKARTEN_BACKUP_USER:?Set WORTKARTEN_BACKUP_USER}
wk_repo=${WORTKARTEN_BACKUP_REPO:?Set WORTKARTEN_BACKUP_REPO}
[[ "$wk_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Unsupported user name' >&2; exit 1; }
wk_repo=$(realpath -e -- "$wk_repo")
wk_home=$(getent passwd "$wk_user" | cut -d: -f6)
for wk_path in "$wk_repo" "$wk_home"; do [[ "$wk_path" =~ ^/[A-Za-z0-9_/-]+$ && "$wk_path" != / ]] || { echo 'Use a plain absolute user/repo path without spaces' >&2; exit 1; }; done
[[ -f "$wk_repo/scripts/backup-offsite.cjs" && -f "$wk_repo/deploy/backup/run-backup.sh" && -f "$wk_home/.config/wortkarten/backup.env" && -f "$wk_home/.config/wortkarten/node22.path" ]] || { echo 'Complete app/backup setup first' >&2; exit 1; }
for wk_unit in wortkarten-backup.service wortkarten-backup.timer; do [[ ! -e "/etc/systemd/system/$wk_unit" ]] || { echo "Unit already exists: $wk_unit; inspect it before changing" >&2; exit 1; }; done
wk_tmp=$(mktemp -d)
for wk_unit in wortkarten-backup.service wortkarten-backup.timer; do
  sed -e "s|@APP_USER@|$wk_user|g" -e "s|@APP_HOME@|$wk_home|g" -e "s|@APP_REPO@|$wk_repo|g" "$wk_repo/deploy/backup/$wk_unit" > "$wk_tmp/$wk_unit"
done
systemd-analyze verify "$wk_tmp/wortkarten-backup.service" "$wk_tmp/wortkarten-backup.timer"
install -m 644 "$wk_tmp/wortkarten-backup.service" /etc/systemd/system/wortkarten-backup.service
install -m 644 "$wk_tmp/wortkarten-backup.timer" /etc/systemd/system/wortkarten-backup.timer
systemctl daemon-reload
echo 'Units installed but NOT enabled. Complete first archive+SQL restore acceptance before enabling the timer.'
