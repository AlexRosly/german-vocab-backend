#!/usr/bin/env bash
# Adds monitoring only to the owner's already installed script-backup service.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
wk_user=wortkarten
wk_home=/home/wortkarten
wk_repo=$wk_home/apps/german-vocab-backend
wk_unit=wortkarten-script-backup.service
wk_runner=$wk_repo/deploy/backup/run-monitored-script.sh
wk_dropdir=/etc/systemd/system/$wk_unit.d
wk_dropin=$wk_dropdir/monitor.conf
[[ -f "$wk_runner" ]] || { echo 'Pull the monitoring scripts first.' >&2; exit 1; }
[[ $(systemctl show "$wk_unit" -p User --value) == "$wk_user" ]] || { echo 'Unexpected service user.' >&2; exit 1; }
[[ $(systemctl show "$wk_unit" -p FragmentPath --value) == "/etc/systemd/system/$wk_unit" ]] || { echo 'Unexpected service file.' >&2; exit 1; }
[[ -z $(systemctl show "$wk_unit" -p DropInPaths --value) ]] || { echo 'Existing service overrides found; inspect them before changing.' >&2; exit 1; }
[[ $(systemctl show "$wk_unit" -p ActiveState --value) =~ ^(inactive|failed)$ ]] || { echo 'Wait for the running backup to finish.' >&2; exit 1; }
[[ ! -e "$wk_dropin" && ! -L "$wk_dropin" && ! -L "$wk_dropdir" ]] || { echo 'Override path already exists or is a symlink.' >&2; exit 1; }
/bin/bash -n "$wk_runner"
runuser -u "$wk_user" -- /usr/bin/env -i HOME="$wk_home" PATH="$wk_home/.local/bin:/usr/local/bin:/usr/bin:/bin" /bin/bash "$wk_runner" --check-config
wk_tmp=$(mktemp)
trap 'rm -f -- "$wk_tmp"' EXIT
cat > "$wk_tmp" <<EOF
[Service]
ExecStart=
ExecStart=/bin/bash $wk_runner
EOF
install -d -m 755 "$wk_dropdir"
install -m 644 "$wk_tmp" "$wk_dropin"
if ! systemd-analyze verify "/etc/systemd/system/$wk_unit"; then
  rm -f -- "$wk_dropin"
  echo 'Override validation failed; new override removed.' >&2
  exit 1
fi
systemctl daemon-reload
echo 'Monitoring override installed. Backup and timer were not started or rescheduled.'
