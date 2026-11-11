#!/usr/bin/env bash
# Run as the app user: installs ONLY ~/.local/bin/{restic,rclone}.
set -euo pipefail
umask 077
case "$(uname -m)" in x86_64) wk_arch=amd64 ;; aarch64|arm64) wk_arch=arm64 ;; *) echo 'Unsupported CPU' >&2; exit 1 ;; esac
for wk_tool in curl unzip bzip2 sha256sum; do command -v "$wk_tool" >/dev/null || { echo "Missing prerequisite: $wk_tool" >&2; exit 1; }; done
wk_tmp=$(mktemp -d)
wk_restic=0.19.1
wk_rclone=1.76.0
wk_restic_file="restic_${wk_restic}_linux_${wk_arch}.bz2"
wk_rclone_file="rclone-v${wk_rclone}-linux-${wk_arch}.zip"
curl -fsSL "https://github.com/restic/restic/releases/download/v${wk_restic}/SHA256SUMS" -o "$wk_tmp/restic-sums"
curl -fsSL "https://github.com/restic/restic/releases/download/v${wk_restic}/${wk_restic_file}" -o "$wk_tmp/$wk_restic_file"
awk -v file="$wk_restic_file" '$2==file {print}' "$wk_tmp/restic-sums" > "$wk_tmp/restic-selected"
[[ $(wc -l < "$wk_tmp/restic-selected") -eq 1 ]] || { echo 'Missing restic checksum' >&2; exit 1; }
(cd "$wk_tmp" && sha256sum --check restic-selected)
curl -fsSL "https://downloads.rclone.org/v${wk_rclone}/SHA256SUMS" -o "$wk_tmp/rclone-sums"
curl -fsSL "https://downloads.rclone.org/v${wk_rclone}/${wk_rclone_file}" -o "$wk_tmp/$wk_rclone_file"
awk -v file="$wk_rclone_file" '$2==file {print}' "$wk_tmp/rclone-sums" > "$wk_tmp/rclone-selected"
[[ $(wc -l < "$wk_tmp/rclone-selected") -eq 1 ]] || { echo 'Missing rclone checksum' >&2; exit 1; }
(cd "$wk_tmp" && sha256sum --check rclone-selected)
bzip2 --decompress --stdout "$wk_tmp/$wk_restic_file" > "$wk_tmp/restic"
unzip -q "$wk_tmp/$wk_rclone_file" -d "$wk_tmp/rclone-unpacked"
mkdir -p "$HOME/.local/bin"
for wk_name in restic rclone; do [[ ! -e "$HOME/.local/bin/$wk_name" ]] || { echo "Existing private $wk_name: inspect before replacing" >&2; exit 1; }; done
install -m 755 "$wk_tmp/restic" "$HOME/.local/bin/restic"
install -m 755 "$wk_tmp/rclone-unpacked/rclone-v${wk_rclone}-linux-${wk_arch}/rclone" "$HOME/.local/bin/rclone"
"$HOME/.local/bin/restic" version
"$HOME/.local/bin/rclone" version
printf 'Verified downloads retained in: %s\n' "$wk_tmp"
