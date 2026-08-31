#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export ANDROID_HOME="${HOME}/Android/Sdk"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

AVD_NAME="android_test_avd"
PORT=5173
VITE_PID=""
EMULATOR_PID=""

cleanup() {
  echo "=== [Cleanup] Stopping background processes ==="
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

echo "=== [1/5] Checking Android Device / Emulator ==="
DEVICE_LIST=$(adb devices 2>/dev/null | grep -w "device" || true)

if [[ -z "${DEVICE_LIST}" ]]; then
  echo "No active Android device detected. Starting headless emulator '${AVD_NAME}'..."
  EMULATOR_BIN="${ANDROID_HOME}/emulator/emulator"
  if [[ ! -x "${EMULATOR_BIN}" ]]; then
    echo "Error: Android emulator executable not found at ${EMULATOR_BIN}" >&2
    echo "Please run 'bash scripts/setup-headless-android.sh' first." >&2
    exit 1
  fi

  mkdir -p /tmp/android-logs
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

echo "=== [2/5] Installing Standard Notes Official APK ==="
APK_PATH="${ROOT_DIR}/artifacts/standardnotes.apk"
if [[ ! -f "${APK_PATH}" ]]; then
  echo "APK not found. Downloading..."
  bash "${SCRIPT_DIR}/download-official-sn-apk.sh"
fi

adb install -r "${APK_PATH}"

echo "=== [3/5] Starting Local Editor Server (Port: ${PORT}) ==="
cd "${ROOT_DIR}"
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

echo "=== [4/5] Running Android E2E Tests with WebdriverIO ==="
npm run test:e2e:android-app

echo "=== [5/5] Test Suite Completed Successfully! ==="
