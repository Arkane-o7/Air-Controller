#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer Homebrew Ruby on macOS if present.
if [[ -x "/opt/homebrew/opt/ruby/bin/ruby" ]]; then
  export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"
fi

if ! command -v bundle >/dev/null 2>&1; then
  echo "ERROR: bundler is not installed or not on PATH."
  exit 1
fi

cd "$ROOT_DIR"
bundle config set path vendor/bundle
bundle install
bundle exec jekyll build

echo "Website build completed: $ROOT_DIR/_site"
