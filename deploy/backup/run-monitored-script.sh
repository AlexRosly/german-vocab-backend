#!/usr/bin/env bash
# Sends status only, never backup contents, log bodies, credentials or the ping URL.
set -uo pipefail

wk_hb_read_config() {
  local wk_mode wk_owner wk_parent wk_private
  wk_url_file=${WORTKARTEN_BACKUP_PING_FILE:-$HOME/.config/wortkarten/backup-ping.url}
  [[ -f "$wk_url_file" && ! -L "$wk_url_file" && -r "$wk_url_file" ]] || return 1
  wk_parent=$(dirname -- "$wk_url_file")
  for wk_private in "$wk_url_file" "$wk_parent"; do
    [[ ! -L "$wk_private" ]] || return 1
    wk_owner=$(stat -c %u -- "$wk_private") || return 1
    wk_mode=$(stat -c %a -- "$wk_private") || return 1
    [[ "$wk_owner" == "$(id -u)" && "$wk_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$wk_mode & 077) == 0 )) || return 1
  done
  [[ $(wc -c < "$wk_url_file") -le 128 ]] || return 1
  wk_ping_url=$(cat -- "$wk_url_file") || return 1
  [[ "$wk_ping_url" =~ ^https://hc-ping\.com/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$ ]] || return 1
  command -v curl >/dev/null 2>&1 || return 1
}

wk_hb_ping() {
  local wk_suffix=${1:-} wk_http
  # stdin configuration keeps the private URL out of process arguments.
  # --disable ignores ~/.curlrc; no redirects or request bodies are used.
  wk_http=$(printf 'url = "%s%s"\n' "$wk_ping_url" "$wk_suffix" |
    curl --disable --config - --silent --fail --max-time 10 --retry 1 --retry-max-time 25 --output /dev/null --write-out '%{http_code}' 2>/dev/null) || return 1
  [[ "$wk_http" == 200 ]]
}

wk_hb_finish() {
  local wk_status=$?
  trap - EXIT INT TERM
  if [[ "$wk_monitor_ready" != 1 ]]; then
    echo 'Backup monitor unavailable: inspect the private ping configuration. Backup was still attempted.' >&2
    (( wk_status != 0 )) || wk_status=78
  elif (( wk_status == 0 )); then
    if wk_hb_ping ''; then
      echo 'Backup success delivered to Healthchecks.'
    else
      echo 'Backup completed, but success notification failed.' >&2
      wk_status=75
    fi
  else
    if wk_hb_ping /fail; then
      echo 'Backup failure delivered to Healthchecks.' >&2
    else
      echo 'Backup failed; failure notification could not be delivered. External missed-run monitoring remains necessary.' >&2
    fi
  fi
  exit "$wk_status"
}

wk_ping_url=''
wk_monitor_ready=0
if wk_hb_read_config; then wk_monitor_ready=1; fi
if [[ ${1:-} == --check-config ]]; then
  [[ "$wk_monitor_ready" == 1 ]] || { echo 'Private ping configuration is missing, unsafe, invalid, or curl is unavailable.' >&2; exit 78; }
  echo 'Private monitor configuration is ready. No ping or backup was performed.'
  exit 0
fi
[[ $# == 0 ]] || { echo 'Unsupported arguments.' >&2; exit 64; }
trap wk_hb_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "$wk_monitor_ready" == 1 ]]; then
  wk_hb_ping /start || echo 'Start notification failed; continuing the backup.' >&2
fi
wk_backup_script=${WORTKARTEN_BACKUP_SCRIPT:-$HOME/scripts/backup-german-vocab.sh}
if /bin/bash "$wk_backup_script"; then exit 0; else exit "$?"; fi
