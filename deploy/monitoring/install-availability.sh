#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
wk_home=/home/wortkarten
wk_repo=$wk_home/apps/german-vocab-backend
wk_user=wortkarten
wk_unit=wortkarten-availability
[[ -x /usr/bin/node && -f "$wk_repo/scripts/check-availability.cjs" ]] || { echo 'Pull the monitor code and verify /usr/bin/node first.' >&2; exit 1; }
for wk_name in "$wk_unit.service" "$wk_unit.timer"; do
  if systemctl cat "$wk_name" >/dev/null 2>&1 || [[ -e "/etc/systemd/system/$wk_name" || -L "/etc/systemd/system/$wk_name" ]]; then
    echo "Existing unit: $wk_name; inspect before changing." >&2; exit 1
  fi
done
runuser -u "$wk_user" -- /usr/bin/env -i HOME="$wk_home" PATH=/usr/local/bin:/usr/bin:/bin /usr/bin/node "$wk_repo/scripts/check-availability.cjs" --check-config
wk_tmp=$(mktemp -d)
trap 'rm -f -- "$wk_tmp/wortkarten-availability.service" "$wk_tmp/wortkarten-availability.timer"; rmdir -- "$wk_tmp"' EXIT
cat > "$wk_tmp/$wk_unit.service" <<EOF
[Unit]
Description=Wortkarten public availability and server error monitor
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$wk_user
Environment=HOME=$wk_home
Environment=PATH=/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$wk_repo
ExecStart=/usr/bin/node $wk_repo/scripts/check-availability.cjs
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
TimeoutStartSec=60
StandardOutput=journal
StandardError=journal
EOF
cat > "$wk_tmp/$wk_unit.timer" <<EOF
[Unit]
Description=Check Wortkarten availability every five minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
AccuracySec=1s
Unit=$wk_unit.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify "$wk_tmp/$wk_unit.service" "$wk_tmp/$wk_unit.timer"
install -m 644 "$wk_tmp/$wk_unit.service" "/etc/systemd/system/$wk_unit.service"
install -m 644 "$wk_tmp/$wk_unit.timer" "/etc/systemd/system/$wk_unit.timer"
systemctl daemon-reload
echo 'Availability units installed but NOT enabled. Run the service once, verify Healthchecks, then enable the timer.'
