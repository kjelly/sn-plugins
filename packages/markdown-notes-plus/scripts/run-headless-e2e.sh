#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export ANDROID_HOME="${HOME}/Android/Sdk"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

AVD_NAME="android_test_avd"
PORT=5173
APPIUM_PORT=4723
VITE_PID=""
APPIUM_PID=""
EMULATOR_PID=""

mkdir -p /tmp/android-logs

cleanup() {
  echo "=== [Cleanup] Stopping background processes ==="
  if [[ -n "${APPIUM_PID}" ]] && kill -0 "${APPIUM_PID}" 2>/dev/null; then
    echo "Stopping Appium server (PID: ${APPIUM_PID})..."
    kill "${APPIUM_PID}" || true
  fi

  if [[ -n "${VITE_PID}" ]] && kill -0 "${VITE_PID}" 2>/dev/null; then
    echo "Stopping Vite server (PID: ${VITE_PID})..."
    kill "${VITE_PID}" || true
  fi

  if [[ -n "${EMULATOR_PID}" ]] && kill -0 "${EMULATOR_PID}" 2>/dev/null; then
    echo "Stopping Headless Emulator (PID: ${EMULATOR_PID})..."
    if command -v adb >/dev/null 2>&1; then
      adb emu kill >/dev/null 2>&1 || true
    fi
    kill "${EMULATOR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "=== [1/6] Verifying Test Dependencies (WebdriverIO & Appium) ==="
cd "${ROOT_DIR}"
if [[ ! -x "${ROOT_DIR}/node_modules/.bin/wdio" ]] || [[ ! -x "${ROOT_DIR}/node_modules/.bin/appium" ]]; then
  echo "WebdriverIO or Appium missing in node_modules. Installing..."
  npm install -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio appium
fi

# Ensure uiautomator2 driver is registered in Appium
if ! npx appium driver list --installed 2>/dev/null | grep -q "uiautomator2"; then
  echo "Installing Appium uiautomator2 driver..."
  npx appium driver install uiautomator2 2>/dev/null || true
fi

echo "=== [2/6] Checking Android Device / Emulator ==="
DEVICE_LIST=$(adb devices 2>/dev/null | grep -w "device" || true)

if [[ -z "${DEVICE_LIST}" ]]; then
  echo "No active Android device detected. Starting headless emulator '${AVD_NAME}'..."
  EMULATOR_BIN="${ANDROID_HOME}/emulator/emulator"
  if [[ ! -x "${EMULATOR_BIN}" ]]; then
    echo "Error: Android emulator executable not found at ${EMULATOR_BIN}" >&2
    echo "Please run 'bash scripts/setup-headless-android.sh' first." >&2
    exit 1
  fi

  "${EMULATOR_BIN}" -avd "${AVD_NAME}" \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -gpu swiftshader_indirect \
    -no-snapshot \
    -memory 2048 \
    > /tmp/android-logs/emulator.log 2>&1 &
  EMULATOR_PID=$!
  echo "Emulator launched with PID ${EMULATOR_PID}. Waiting for boot..."

  adb wait-for-device
  echo "Waiting for Android system boot completion..."
  while [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; do
    sleep 2
  done
  adb shell input keyevent 82 || true
  echo "Android emulator successfully booted!"
else
  echo "Found active Android device:"
  echo "${DEVICE_LIST}"
fi

echo "=== [3/6] Installing Standard Notes Official APK ==="
APK_PATH="${ROOT_DIR}/artifacts/standardnotes.apk"
if [[ ! -f "${APK_PATH}" ]]; then
  echo "APK not found. Downloading..."
  bash "${SCRIPT_DIR}/download-official-sn-apk.sh"
fi

adb install -r "${APK_PATH}"

echo "=== [4/6] Starting Local Editor Server (Port: ${PORT}) ==="
npm run dev -- --host 0.0.0.0 --port "${PORT}" --strictPort > /tmp/android-logs/vite.log 2>&1 &
VITE_PID=$!

echo "Waiting for Vite server to become responsive..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${PORT}/ext.json" >/dev/null 2>&1; then
    echo "Vite server is ready at http://127.0.0.1:${PORT}"
    break
  fi
  sleep 1
done

echo "=== [5/6] Starting Appium Server (Port: ${APPIUM_PORT}) ==="
npx appium --port "${APPIUM_PORT}" --relaxed-security > /tmp/android-logs/appium.log 2>&1 &
APPIUM_PID=$!

echo "Waiting for Appium server to become responsive..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${APPIUM_PORT}/status" >/dev/null 2>&1; then
    echo "Appium server is ready at http://127.0.0.1:${APPIUM_PORT}"
    break
  fi
  sleep 1
done

echo "=== [6/6] Running Android E2E Tests with WebdriverIO ==="
npx wdio run tests/e2e-android/wdio.conf.ts

echo "=== Test Suite Completed Successfully! ==="
