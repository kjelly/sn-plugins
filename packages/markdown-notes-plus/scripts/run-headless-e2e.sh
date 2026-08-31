#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

AVD_NAME="android_test_avd"
PORT=5173
STANDARD_NOTES_PACKAGE="com.standardnotes"
NOTIFICATION_PERMISSION="android.permission.POST_NOTIFICATIONS"
export APPIUM_PORT="${APPIUM_PORT:-4723}"
export ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-35.0.0}"
BUILD_TOOLS_DIR="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
APKSIGNER_JAR="${BUILD_TOOLS_DIR}/lib/apksigner.jar"
APKSIGNER_BIN="${BUILD_TOOLS_DIR}/apksigner"
VITE_PID=""
APPIUM_PID=""
EMULATOR_PID=""
VITE_START_TIME=""
APPIUM_START_TIME=""
EMULATOR_START_TIME=""

mkdir -p /tmp/android-logs
RUN_LOG_DIR="$(mktemp -d "/tmp/android-logs/run-$(date +%Y%m%dT%H%M%S)-XXXXXX")"
VITE_LOG="${RUN_LOG_DIR}/vite.log"
APPIUM_LOG="${RUN_LOG_DIR}/appium.log"
EMULATOR_LOG="${RUN_LOG_DIR}/emulator.log"
EXPECTED_MANIFEST_URL="http://10.0.2.2:${PORT}/index.html"

echo "Run artifacts: ${RUN_LOG_DIR}"

proc_start_time() {
  local pid="$1"
  awk '{print $22}' "/proc/${pid}/stat" 2>/dev/null || true
}

proc_cmdline() {
  local pid="$1"
  tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true
}

process_is_expected() {
  local pid="$1"
  local start_time="$2"
  local marker="$3"
  local cmdline

  [[ -n "${pid}" ]] || return 1
  [[ -n "${start_time}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  [[ "$(proc_start_time "${pid}")" == "${start_time}" ]] || return 1
  cmdline="$(proc_cmdline "${pid}")"
  [[ "${cmdline}" == *"${marker}"* ]]
}

stop_process() {
  local label="$1"
  local pid="$2"
  local start_time="$3"
  local marker="$4"

  if process_is_expected "${pid}" "${start_time}" "${marker}"; then
    echo "Stopping ${label} (PID: ${pid})..."
    kill "${pid}" 2>/dev/null || true
  fi
}

port_is_in_use() {
  local port="$1"

  if timeout 1 bash -c ": </dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    return 0
  fi

  if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :${port}" 2>/dev/null | grep -q .; then
    return 0
  fi

  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    return 0
  fi

  return 1
}

print_port_diagnostic() {
  local port="$1"

  echo "Diagnostics for port ${port}:"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :${port}" 2>&1 || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>&1 || true
  fi
  echo "A TCP listener answered on 127.0.0.1:${port}; refusing to reuse or terminate it."
}

print_logs() {
  local log_file

  for log_file in "${VITE_LOG}" "${APPIUM_LOG}" "${EMULATOR_LOG}"; do
    echo "--- ${log_file} ---"
    if [[ -f "${log_file}" ]]; then
      sed -n '1,240p' "${log_file}"
    else
      echo "(no log)"
    fi
  done
}

establish_notification_permission() {
  echo "=== Establishing Android notification permission before app launch ==="
  if ! adb shell pm grant "${STANDARD_NOTES_PACKAGE}" "${NOTIFICATION_PERMISSION}"; then
    echo "Error: could not pre-grant ${NOTIFICATION_PERMISSION} to ${STANDARD_NOTES_PACKAGE}." >&2
    return 1
  fi

  local package_dump
  if ! package_dump="$(adb shell dumpsys package "${STANDARD_NOTES_PACKAGE}" | tr -d '\r')"; then
    echo "Error: could not inspect ${STANDARD_NOTES_PACKAGE} notification permission state." >&2
    return 1
  fi

  if ! grep -Eq "${NOTIFICATION_PERMISSION}: granted=true" <<<"${package_dump}"; then
    echo "Error: ${NOTIFICATION_PERMISSION} is not granted before Standard Notes launch." >&2
    return 1
  fi
  echo "Notification permission verified before Standard Notes launch."
}

collect_android_diagnostics() {
  local diagnostics_file="${RUN_LOG_DIR}/android-diagnostics.txt"
  {
    echo "=== Focus ==="
    adb shell dumpsys window windows 2>&1 | grep -E "mCurrentFocus|mFocusedApp" || true
    echo "=== Hierarchy ==="
    adb shell uiautomator dump /sdcard/markdown-notes-plus-window.xml >/dev/null 2>&1 || true
    adb shell cat /sdcard/markdown-notes-plus-window.xml 2>&1 || true
    echo "=== Screenshot ==="
    if adb exec-out screencap -p > "${RUN_LOG_DIR}/android-screenshot.png" 2>/dev/null; then
      echo "Saved ${RUN_LOG_DIR}/android-screenshot.png"
    else
      echo "Screenshot unavailable"
    fi
    echo "=== ANR/logcat ==="
    adb logcat -d -t 500 2>&1 | grep -iE "ANR|Application Not Responding|permissioncontroller|com.standardnotes" || true
  } > "${diagnostics_file}"
  echo "Android diagnostics: ${diagnostics_file}"
  sed -n '1,260p' "${diagnostics_file}"
}

is_valid_port() {
  local port="$1"

  [[ "${port}" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535))
}

cleanup() {
  echo "=== [Cleanup] Stopping background processes ==="
  stop_process "Appium server" "${APPIUM_PID}" "${APPIUM_START_TIME}" "appium"
  stop_process "Vite server" "${VITE_PID}" "${VITE_START_TIME}" "vite"

  if process_is_expected "${EMULATOR_PID}" "${EMULATOR_START_TIME}" "emulator"; then
    echo "Stopping Headless Emulator (PID: ${EMULATOR_PID})..."
    kill "${EMULATOR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

if ! is_valid_port "${PORT}"; then
  echo "Error: Vite PORT must be a numeric TCP port from 1 through 65535 (got '${PORT}')."
  exit 1
fi
if ! is_valid_port "${APPIUM_PORT}"; then
  echo "Error: APPIUM_PORT must be a numeric TCP port from 1 through 65535 (got '${APPIUM_PORT}')."
  exit 1
fi
PORT_NUMBER=$((10#${PORT}))
APPIUM_PORT_NUMBER=$((10#${APPIUM_PORT}))
if ((PORT_NUMBER == APPIUM_PORT_NUMBER)); then
  echo "Error: Vite PORT (${PORT}) and APPIUM_PORT (${APPIUM_PORT}) must be distinct."
  exit 1
fi

echo "=== [Preflight] Checking required ports ==="
for required_port in "${PORT}" "${APPIUM_PORT}"; do
  if port_is_in_use "${required_port}"; then
    echo "Error: Port ${required_port} is already in use."
    print_port_diagnostic "${required_port}"
    exit 1
  fi
done

echo "=== [Preflight] Checking Android Build Tools (${ANDROID_BUILD_TOOLS_VERSION}) ==="
if [[ ! -x "${APKSIGNER_BIN}" ]] || [[ ! -f "${APKSIGNER_JAR}" ]]; then
  echo "Error: Android Build Tools ${ANDROID_BUILD_TOOLS_VERSION} is missing the Appium signing tools." >&2
  echo "Expected executable: ${APKSIGNER_BIN}" >&2
  echo "Expected jar: ${APKSIGNER_JAR}" >&2
  echo "Please run 'bash scripts/setup-headless-android.sh' first." >&2
  exit 1
fi
echo "Android Build Tools ready: ${APKSIGNER_BIN} and ${APKSIGNER_JAR}"

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
    > "${EMULATOR_LOG}" 2>&1 &
  EMULATOR_PID=$!
  EMULATOR_START_TIME="$(proc_start_time "${EMULATOR_PID}")"
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
establish_notification_permission

echo "=== [4/6] Starting Local Editor Server (Port: ${PORT}) ==="
"${ROOT_DIR}/node_modules/.bin/vite" --host 0.0.0.0 --port "${PORT}" --strictPort > "${VITE_LOG}" 2>&1 &
VITE_PID=$!
VITE_START_TIME="$(proc_start_time "${VITE_PID}")"

echo "Waiting for Vite server to become responsive..."
for i in {1..30}; do
  if ! process_is_expected "${VITE_PID}" "${VITE_START_TIME}" "vite"; then
    echo "Error: Vite child exited or changed identity before readiness."
    print_logs
    exit 1
  fi
  if manifest="$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/ext.json" 2>/dev/null)" \
    && printf '%s' "${manifest}" \
      | EXPECTED_IDENTIFIER="org.standardnotes.markdown-notes-plus" \
        EXPECTED_NAME="Markdown Notes+" \
        EXPECTED_CONTENT_TYPE="SN|Component" \
        EXPECTED_AREA="editor-editor" \
        EXPECTED_URL="${EXPECTED_MANIFEST_URL}" \
        node --input-type=module -e '
          import fs from "node:fs";

          const manifest = JSON.parse(fs.readFileSync(0, "utf8"));
          const expected = {
            identifier: process.env.EXPECTED_IDENTIFIER,
            name: process.env.EXPECTED_NAME,
            content_type: process.env.EXPECTED_CONTENT_TYPE,
            area: process.env.EXPECTED_AREA,
            url: process.env.EXPECTED_URL,
          };
          for (const [key, value] of Object.entries(expected)) {
            if (manifest[key] !== value) {
              throw new Error(`manifest ${key} mismatch: expected ${value}, got ${manifest[key]}`);
            }
          }
        ';
  then
    echo "Vite server is ready at http://127.0.0.1:${PORT}"
    break
  fi
  if [[ "${i}" -eq 30 ]]; then
    echo "Error: Vite did not become ready with the expected extension manifest."
    print_logs
    exit 1
  fi
  sleep 1
done

echo "=== [5/6] Starting Appium Server (Port: ${APPIUM_PORT}) ==="
"${ROOT_DIR}/node_modules/.bin/appium" --port "${APPIUM_PORT}" --relaxed-security > "${APPIUM_LOG}" 2>&1 &
APPIUM_PID=$!
APPIUM_START_TIME="$(proc_start_time "${APPIUM_PID}")"

echo "Waiting for Appium server to become responsive..."
for i in {1..30}; do
  if ! process_is_expected "${APPIUM_PID}" "${APPIUM_START_TIME}" "appium"; then
    echo "Error: Appium child exited or changed identity before readiness."
    print_logs
    exit 1
  fi
  if status="$(curl -fsS --max-time 2 "http://127.0.0.1:${APPIUM_PORT}/status" 2>/dev/null)" \
    && printf '%s' "${status}" \
      | node --input-type=module -e '
          import fs from "node:fs";

          const status = JSON.parse(fs.readFileSync(0, "utf8"));
          if (status?.value?.ready !== true && status?.status !== 0) {
            throw new Error("Appium status did not report ready");
          }
        ';
  then
    echo "Appium server is ready at http://127.0.0.1:${APPIUM_PORT}"
    break
  fi
  if [[ "${i}" -eq 30 ]]; then
    echo "Error: Appium did not become ready at /status."
    print_logs
    exit 1
  fi
  sleep 1
done

echo "=== [6/6] Running Android E2E Tests with WebdriverIO ==="
if ! npx wdio run tests/e2e-android/wdio.conf.ts; then
  echo "Android E2E failed; collecting launch/ANR diagnostics."
  collect_android_diagnostics
  exit 1
fi

echo "=== Test Suite Completed Successfully! ==="
