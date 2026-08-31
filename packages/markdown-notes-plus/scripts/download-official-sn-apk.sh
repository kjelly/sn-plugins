#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARTIFACTS_DIR="${ROOT_DIR}/artifacts"
TARGET_APK="${ARTIFACTS_DIR}/standardnotes.apk"

mkdir -p "${ARTIFACTS_DIR}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Target APK location: ${TARGET_APK}"
  exit 0
fi

if [[ -f "${TARGET_APK}" ]]; then
  echo "Found existing Standard Notes APK at ${TARGET_APK}. Skipping download."
  exit 0
fi

echo "Fetching latest official Standard Notes Android release from GitHub..."
RELEASE_JSON=$(curl -sSL "https://api.github.com/repos/standardnotes/app/releases/latest" || true)
APK_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*standard-notes[^"]*\.apk' | head -n 1 || true)

if [[ -z "${APK_URL}" ]]; then
  echo "Fallback: Querying recent releases for android apk..."
  RELEASES_ALL=$(curl -sSL "https://api.github.com/repos/standardnotes/app/releases?per_page=5" || true)
  APK_URL=$(echo "${RELEASES_ALL}" | grep -o 'https://[^"]*\.apk' | head -n 1 || true)
fi

if [[ -z "${APK_URL}" ]]; then
  echo "Error: Could not locate an official .apk release asset from standardnotes/app repository." >&2
  exit 1
fi

echo "Downloading from: ${APK_URL}"
curl -fL --progress-bar "${APK_URL}" -o "${TARGET_APK}"
echo "Successfully downloaded official APK to ${TARGET_APK}"
