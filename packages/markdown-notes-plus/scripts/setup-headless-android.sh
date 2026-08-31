#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

AVD_NAME="android_test_avd"
SYSTEM_IMAGE="system-images;android-33;google_apis;x86_64"
export ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
BUILD_TOOLS_DIR="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
APKSIGNER_JAR="${BUILD_TOOLS_DIR}/lib/apksigner.jar"
APKSIGNER_BIN="${BUILD_TOOLS_DIR}/apksigner"

echo "=== [1/6] Checking Java & System Prerequisites ==="
if ! command -v java >/dev/null 2>&1; then
  echo "Java not found. Installing OpenJDK 17..."
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless unzip curl
  else
    echo "Error: sudo is required to install openjdk-17-jdk-headless" >&2
    exit 1
  fi
fi

echo "=== [2/6] Setting up Android SDK Command-line Tools ==="
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

echo "=== [3/6] Accepting Licenses & Installing SDK Packages ==="
yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

echo "Installing platform-tools, emulator, build-tools (${ANDROID_BUILD_TOOLS_VERSION}), and system-image (${SYSTEM_IMAGE})..."
"${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" \
  "emulator" \
  "build-tools;${ANDROID_BUILD_TOOLS_VERSION}" \
  "${SYSTEM_IMAGE}"

echo "Android Build Tools diagnostics:"
echo "  version: ${ANDROID_BUILD_TOOLS_VERSION}"
echo "  directory: ${BUILD_TOOLS_DIR}"
echo "  apksigner executable: ${APKSIGNER_BIN}"
echo "  apksigner jar: ${APKSIGNER_JAR}"
if [[ ! -x "${APKSIGNER_BIN}" ]] || [[ ! -f "${APKSIGNER_JAR}" ]]; then
  echo "Error: Android Build Tools ${ANDROID_BUILD_TOOLS_VERSION} did not provide the Appium signing tools." >&2
  exit 1
fi

echo "=== [4/6] Creating Headless AVD (${AVD_NAME}) ==="
echo "no" | "${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager" create avd \
  -n "${AVD_NAME}" \
  -k "${SYSTEM_IMAGE}" \
  --force

echo "=== [5/6] Downloading Official Standard Notes APK ==="
bash "${SCRIPT_DIR}/download-official-sn-apk.sh"

echo "=== [6/6] Installing Appium & WebdriverIO Dependencies ==="
cd "${ROOT_DIR}"
npm install -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio appium
npx appium driver install uiautomator2 2>/dev/null || true

echo ""
echo "========================================================"
echo " Headless Android Setup Completed Successfully! "
echo "========================================================"
echo "To run your E2E tests, execute:"
echo "  bash scripts/run-headless-e2e.sh"
echo "========================================================"
