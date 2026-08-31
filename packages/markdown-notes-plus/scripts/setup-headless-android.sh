#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export ANDROID_HOME="${HOME}/Android/Sdk"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

AVD_NAME="android_test_avd"
SYSTEM_IMAGE="system-images;android-33;google_apis;x86_64"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

echo "=== [1/5] Checking Java & System Prerequisites ==="
if ! command -v java >/dev/null 2>&1; then
  echo "Java not found. Installing OpenJDK 17..."
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless unzip curl
  else
    echo "Error: sudo is required to install openjdk-17-jdk-headless" >&2
    exit 1
  fi
fi

echo "=== [2/5] Setting up Android SDK Command-line Tools ==="
mkdir -p "${ANDROID_HOME}/cmdline-tools"

if [[ ! -d "${ANDROID_HOME}/cmdline-tools/latest" ]]; then
  echo "Downloading Android Command-line Tools..."
  TMP_DIR=$(mktemp -d)
  curl -sSL "${CMDLINE_TOOLS_URL}" -o "${TMP_DIR}/cmdline-tools.zip"
  unzip -q "${TMP_DIR}/cmdline-tools.zip" -d "${TMP_DIR}"
  mkdir -p "${ANDROID_HOME}/cmdline-tools/latest"
  cp -r "${TMP_DIR}/cmdline-tools/"* "${ANDROID_HOME}/cmdline-tools/latest/"
  rm -rf "${TMP_DIR}"
fi

echo "=== [3/5] Accepting Licenses & Installing SDK Packages ==="
yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

echo "Installing platform-tools, emulator, and system-image (${SYSTEM_IMAGE})..."
"${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "emulator" "${SYSTEM_IMAGE}"

echo "=== [4/5] Creating Headless AVD (${AVD_NAME}) ==="
echo "no" | "${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager" create avd \
  -n "${AVD_NAME}" \
  -k "${SYSTEM_IMAGE}" \
  --force

echo "=== [5/5] Downloading Official Standard Notes APK ==="
bash "${SCRIPT_DIR}/download-official-sn-apk.sh"

echo ""
echo "========================================================"
echo " Headless Android Setup Completed Successfully! "
echo "========================================================"
echo "To run your E2E tests, execute:"
echo "  bash scripts/run-headless-e2e.sh"
echo "========================================================"
