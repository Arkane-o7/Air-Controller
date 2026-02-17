#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PC_DIR="$ROOT_DIR/VirtualGamePad-PC"

"$ROOT_DIR/scripts/sync_data_exchange.sh"

case "$(uname -s)" in
  Linux*)
    preset="linux"
    build_dir="build-linux"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    preset="windows"
    build_dir="build-windows"
    ;;
  *)
    if [[ "${FORCE_PC_BUILD:-0}" == "1" ]]; then
      echo "ERROR: PC server build supports Linux/Windows only."
      exit 1
    fi
    echo "Skipping PC server build on unsupported host ($(uname -s))."
    exit 0
    ;;
esac

if ! command -v cmake >/dev/null 2>&1; then
  echo "ERROR: cmake is not installed or not on PATH."
  exit 1
fi

cd "$PC_DIR"
cmake --preset "$preset"
cmake --build "$build_dir" --config Release

echo "PC server build completed for preset: $preset"
