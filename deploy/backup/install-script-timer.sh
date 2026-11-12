#!/usr/bin/env bash
# Schedule the owner's existing pg_dump/project/rclone script, not the restic workflow.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }

wk_user=wortkarten
wk_home=/home/wortkarten
wk_repo=$wk_home/apps/german-vocab-backend
wk_script=$wk_home/scripts/backup-german-vocab.sh
wk_rclone=$wk_home/.local/bin/rclone
wk_unit=wortkarten-script-backup
wk_path=$wk_home/.local/bin:/usr/local/bin:/usr/bin:/bin

[[ $(getent passwd "$wk_user" | cut -d: -f6) == "$wk_home" ]] || { echo 'Unexpected app home.' >&2; exit 1; }
[[ -d "$wk_repo" && -f "$wk_script" ]] || { echo 'Existing app/script is missing.' >&2; exit 1; }
runuser -u "$wk_user" -- test -r "$wk_script"
runuser -u "$wk_user" -- test -x "$wk_rclone"
/bin/bash -n "$wk_script"
runuser -u "$wk_user" -- /usr/bin/env -i HOME="$wk_home" USER="$wk_user" LOGNAME="$wk_user" PATH="$wk_path" "$wk_rclone" version >/dev/null
systemd-analyze calendar '*-*-* 03:30:00 Europe/Berlin'

# Refuse to compete with an existing restic timer or overwrite installed units.
for wk_name in "$wk_unit.service" "$wk_unit.timer" wortkarten-backup.service wortkarten-backup.timer; do
  if systemctl cat "$wk_name" >/dev/null 2>&1; then
    echo "Existing unit: $wk_name. Inspect it before installing another schedule." >&2
    exit 1
  fi
done
for wk_name in "$wk_unit.service" "$wk_unit.timer"; do
  [[ ! -e "/etc/systemd/system/$wk_name" && ! -L "/etc/systemd/system/$wk_name" ]] || { echo "Unit path exists: $wk_name" >&2; exit 1; }
done

wk_tmp=$(mktemp -d)
trap 'rm -f -- "$wk_tmp/wortkarten-script-backup.service" "$wk_tmp/wortkarten-script-backup.timer"; rmdir -- "$wk_tmp"' EXIT

cat > "$wk_tmp/$wk_unit.service" <<EOF
[Unit]
Description=Wortkarten existing database and project backup to Google Drive
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$wk_user
Environment=HOME=$wk_home
Environment=PATH=$wk_path
WorkingDirectory=$wk_repo
ExecStartPre=$wk_rclone version
ExecStart=/bin/bash $wk_script
UMask=0077
TimeoutStartSec=2h
StandardOutput=journal
StandardError=journal
EOF

cat > "$wk_tmp/$wk_unit.timer" <<EOF
[Unit]
Description=Wortkarten backup daily at 03:30 Europe/Berlin

[Timer]
OnCalendar=*-*-* 03:30:00 Europe/Berlin
AccuracySec=1s
Persistent=true
Unit=$wk_unit.service

[Install]
WantedBy=timers.target
EOF

systemd-analyze verify "$wk_tmp/$wk_unit.service" "$wk_tmp/$wk_unit.timer"
install -m 644 "$wk_tmp/$wk_unit.service" "/etc/systemd/system/$wk_unit.service"
install -m 644 "$wk_tmp/$wk_unit.timer" "/etc/systemd/system/$wk_unit.timer"
systemctl daemon-reload
echo 'Installed ONLY. Cron is unchanged; the new timer is NOT enabled.'
echo 'Test the service, then disable only the old backup cron line and enable the timer as documented.'
