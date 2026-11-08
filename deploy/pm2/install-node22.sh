#!/usr/bin/env bash
# Run as the dedicated app user. Does not change /usr/bin/node or another user's PM2.
set -euo pipefail
case "$(uname -m)" in x86_64) wk_arch=x64 ;; aarch64|arm64) wk_arch=arm64 ;; *) echo "Unsupported CPU architecture" >&2; exit 1 ;; esac
wk_tmp=$(mktemp -d)
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt --output "$wk_tmp/SHASUMS256.txt"
wk_archive=$(awk -v suffix="-linux-$wk_arch.tar.xz" '$2 ~ /^node-v22\./ && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$wk_tmp/SHASUMS256.txt")
[[ "$wk_archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || { echo "Unexpected Node archive name" >&2; exit 1; }
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v22.x/$wk_archive" --output "$wk_tmp/$wk_archive"
awk -v file="$wk_archive" '$2==file' "$wk_tmp/SHASUMS256.txt" > "$wk_tmp/selected.sha256"
(cd "$wk_tmp" && sha256sum --check selected.sha256)
wk_dir="$HOME/.local/opt/${wk_archive%.tar.xz}"
if [[ -e "$wk_dir" ]]; then echo "Target already exists: $wk_dir; inspect it rather than overwriting" >&2; exit 1; fi
mkdir -p "$wk_dir" "$HOME/.config/wortkarten"
tar --extract --xz --file "$wk_tmp/$wk_archive" --directory "$wk_dir" --strip-components=1
"$wk_dir/bin/node" --version
printf '%s\n' "$wk_dir/bin/node" > "$HOME/.config/wortkarten/node22.path"
printf 'Node path saved in %s\nTemporary download directory: %s\n' "$HOME/.config/wortkarten/node22.path" "$wk_tmp"
