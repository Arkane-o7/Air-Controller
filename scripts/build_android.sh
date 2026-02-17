#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/VirtualGamePad-Mobile"

"$ROOT_DIR/scripts/sync_data_exchange.sh"

# Prefer Homebrew OpenJDK 17 on macOS if present.
if [[ -z "${JAVA_HOME:-}" && -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Prefer Homebrew Android SDK root on macOS if present.
if [[ -z "${ANDROID_SDK_ROOT:-}" && -z "${ANDROID_HOME:-}" && -d "/opt/homebrew/share/android-commandlinetools" ]]; then
  export ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools"
fi
if [[ -z "${ANDROID_SDK_ROOT:-}" && -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi
if [[ -z "${ANDROID_HOME:-}" && -n "${ANDROID_SDK_ROOT:-}" ]]; then
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi

if ! command -v java >/dev/null 2>&1; then
  echo "ERROR: java is not installed or not on PATH."
  exit 1
fi

java_major="$(java -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n1)"
if [[ -z "$java_major" || "$java_major" -lt 17 ]]; then
  echo "ERROR: Android build requires Java 17 or newer."
  echo "Current java -version:"
  java -version
  exit 1
fi

if ! command -v sdkmanager >/dev/null 2>&1; then
  echo "WARNING: sdkmanager not found; assuming Android SDK packages are already installed."
else
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    missing=0
    if [[ ! -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]]; then
      missing=1
    fi
    if [[ ! -f "$ANDROID_SDK_ROOT/platforms/android-36/android.jar" ]]; then
      missing=1
    fi
    if [[ ! -d "$ANDROID_SDK_ROOT/build-tools/35.0.0" ]]; then
      missing=1
    fi
    if [[ ! -d "$ANDROID_SDK_ROOT/build-tools/36.0.0" ]]; then
      missing=1
    fi

    if [[ "$missing" -eq 1 ]]; then
      yes | sdkmanager --licenses >/dev/null || true
      sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0"
    fi
  else
    echo "WARNING: ANDROID_SDK_ROOT is not set; skipping sdkmanager package install."
  fi
fi

cd "$APP_DIR"
chmod +x ./gradlew
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/.gradle-home}"
./gradlew assembleDebug --no-daemon

echo "Android debug build completed."
