#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/build_website.sh"
"$ROOT_DIR/scripts/build_android.sh"
"$ROOT_DIR/scripts/build_pc.sh"

echo "All build steps finished."
