#!/usr/bin/env bash
# Offline integration checks: fake backup/curl; never calls a real monitoring URL.
set -euo pipefail
wk_runner=${1:-$(dirname -- "${BASH_SOURCE[0]}")/../deploy/backup/run-monitored-script.sh}
wk_case=$(mktemp -d)
mkdir -p "$wk_case/bin" "$wk_case/private"
chmod 700 "$wk_case/private"
export WK_REAL_STAT
WK_REAL_STAT=$(command -v stat)
cat > "$wk_case/bin/stat" <<'MOCK'
#!/usr/bin/env bash
# Windows cannot express POSIX 0600 reliably. Simulate permission results only.
if [[ $1 == -c && $2 == %a ]]; then
  echo "${WK_TEST_MODE:-600}"
else
  exec "$WK_REAL_STAT" "$@"
fi
MOCK
cat > "$wk_case/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ "$*" != *hc-ping.com* ]] || exit 90
IFS= read -r wk_config
case "$wk_config" in
  *'/start"') wk_phase=start ;;
  *'/fail"') wk_phase=fail ;;
  *) wk_phase=success ;;
esac
printf '%s\n' "$wk_phase" >> "$WK_TEST_EVENTS"
[[ ${WK_TEST_FAIL_PHASE:-none} != "$wk_phase" ]] || exit 1
if [[ "$wk_phase" == success ]]; then echo "${WK_TEST_HTTP_STATUS:-200}"; else echo 200; fi
MOCK
cat > "$wk_case/backup.sh" <<'MOCK'
#!/usr/bin/env bash
echo backup >> "$WK_TEST_EVENTS"
exit "${WK_TEST_BACKUP_STATUS:-0}"
MOCK
chmod +x "$wk_case/bin/"*
export PATH="$wk_case/bin:$PATH"
export WORTKARTEN_BACKUP_SCRIPT="$wk_case/backup.sh"
export WORTKARTEN_BACKUP_PING_FILE="$wk_case/private/backup-ping.url"
export WK_TEST_EVENTS="$wk_case/events"
wk_valid='https://hc-ping.com/11111111-1111-1111-1111-111111111111'
printf '%s\n' "$wk_valid" > "$WORTKARTEN_BACKUP_PING_FILE"
chmod 600 "$WORTKARTEN_BACKUP_PING_FILE"

wk_run_case() {
  local wk_label=$1 wk_expected_code=$2 wk_expected_events=$3 wk_code=0
  : > "$WK_TEST_EVENTS"
  bash "$wk_runner" > "$wk_case/output" 2>&1 || wk_code=$?
  [[ "$wk_code" == "$wk_expected_code" ]] || { echo "FAIL $wk_label: unexpected exit $wk_code"; exit 1; }
  [[ $(tr '\n' ',' < "$WK_TEST_EVENTS") == "$wk_expected_events" ]] || { echo "FAIL $wk_label: unexpected event order"; exit 1; }
  ! grep -Fq "$wk_valid" "$wk_case/output" || { echo 'FAIL: private URL leaked'; exit 1; }
  echo "PASS $wk_label"
}

wk_run_case success 0 'start,backup,success,'
export WK_TEST_BACKUP_STATUS=7
wk_run_case backup-failure 7 'start,backup,fail,'
export WK_TEST_BACKUP_STATUS=0 WK_TEST_FAIL_PHASE=start
wk_run_case start-failure-does-not-skip-backup 0 'start,backup,success,'
export WK_TEST_FAIL_PHASE=success
wk_run_case missing-success-delivery-is-observable 75 'start,backup,success,'
export WK_TEST_FAIL_PHASE=none WK_TEST_HTTP_STATUS=302
wk_run_case redirect-is-not-a-delivered-success 75 'start,backup,success,'
export WK_TEST_HTTP_STATUS=200
export WK_TEST_BACKUP_STATUS=9 WK_TEST_FAIL_PHASE=fail
wk_run_case notification-failure-preserves-backup-error 9 'start,backup,fail,'
export WK_TEST_BACKUP_STATUS=0 WK_TEST_FAIL_PHASE=none WK_TEST_MODE=644
wk_run_case unsafe-config-still-runs-backup 78 'backup,'
export WK_TEST_MODE=600
printf 'https://example.invalid/private\n' > "$WORTKARTEN_BACKUP_PING_FILE"
wk_run_case wrong-monitor-host-still-runs-backup 78 'backup,'
printf '%s\n' "$wk_valid" > "$WORTKARTEN_BACKUP_PING_FILE"
: > "$WK_TEST_EVENTS"
bash "$wk_runner" --check-config > "$wk_case/config-output"
[[ ! -s "$WK_TEST_EVENTS" ]] || { echo 'FAIL: check-config ran backup or sent a ping'; exit 1; }
echo 'PASS check-config-has-no-side-effects'
echo '9 offline integration checks passed. POSIX permissions must also pass on the VPS installer.'
