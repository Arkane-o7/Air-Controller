#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/VGP_Data_Exchange"
TARGETS=(
  "$ROOT_DIR/VirtualGamePad-Mobile/VGP_Data_Exchange"
  "$ROOT_DIR/VirtualGamePad-PC/VGP_Data_Exchange"
)

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "ERROR: Source data exchange directory not found: $SOURCE_DIR"
  exit 1
fi

for target in "${TARGETS[@]}"; do
  if [[ ! -d "$target" ]]; then
    echo "ERROR: Target data exchange directory not found: $target"
    exit 1
  fi
done

for target in "${TARGETS[@]}"; do
  tmp_dir="$(mktemp -d)"
  cp -a "$SOURCE_DIR"/. "$tmp_dir"/
  rm -rf "$tmp_dir/.git" "$tmp_dir/.DS_Store"
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$tmp_dir"/. "$target"/
  rm -rf "$tmp_dir"
done

echo "Synced VGP_Data_Exchange into mobile and PC modules."
