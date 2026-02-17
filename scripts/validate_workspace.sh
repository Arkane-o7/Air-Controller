#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer Homebrew Ruby on macOS if present.
if [[ -x "/opt/homebrew/opt/ruby/bin/ruby" ]]; then
  export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"
fi

required_paths=(
  "README.md"
  "Gemfile"
  "Gemfile.lock"
  "_config.yml"
  "assets"
  ".github/workflows/website.yml"
  ".github/workflows/android.yml"
  ".github/workflows/pc-server.yml"
  "scripts/build_website.sh"
  "scripts/build_android.sh"
  "scripts/build_pc.sh"
  "scripts/build_all.sh"
  "scripts/sync_data_exchange.sh"
  "VirtualGamePad-Mobile/app/src/main/AndroidManifest.xml"
  "VirtualGamePad-Mobile/VGP_Data_Exchange/GamePadReading.colf"
  "VirtualGamePad-PC/CMakeLists.txt"
  "VirtualGamePad-PC/src/main.cpp"
  "VirtualGamePad-PC/VGP_Data_Exchange/GamePadReading.colf"
  "VirtualGamePad-PC/third-party-libs/QR-Code-generator/python/qrcodegen.py"
  "VirtualGamePad-PC/doxygen-awesome-css/doxygen-awesome.css"
  "VGP_Data_Exchange/GamePadReading.colf"
)

embedded_git_dirs=(
  "VirtualGamePad-Mobile/.git"
  "VirtualGamePad-PC/.git"
  "VGP_Data_Exchange/.git"
)

missing=0

echo "Checking required project files..."
for rel_path in "${required_paths[@]}"; do
  if [[ -e "$ROOT_DIR/$rel_path" ]]; then
    echo "  OK  $rel_path"
  else
    echo "  ERR $rel_path (missing)"
    missing=1
  fi
done

echo
echo "Checking for nested git repositories..."
for rel_path in "${embedded_git_dirs[@]}"; do
  if [[ -d "$ROOT_DIR/$rel_path" ]]; then
    echo "  ERR $rel_path (should not exist in monorepo import)"
    missing=1
  else
    echo "  OK  $rel_path not present"
  fi
done

echo
echo "Local toolchain availability (informational):"
for tool in ruby bundle java cmake ninja; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "  OK  $tool"
  else
    echo "  WARN $tool not found"
  fi
done

if command -v jekyll >/dev/null 2>&1; then
  echo "  OK  jekyll"
elif command -v bundle >/dev/null 2>&1 && bundle exec jekyll -v >/dev/null 2>&1; then
  echo "  OK  jekyll (via bundler)"
else
  echo "  WARN jekyll not found"
fi

if [[ $missing -ne 0 ]]; then
  echo
  echo "Workspace validation FAILED."
  exit 1
fi

echo
echo "Workspace validation passed."
