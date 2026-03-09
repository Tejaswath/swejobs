#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/phase0_cutover.sh /path/to/edge-powered-apps /path/to/swejobs

SOURCE_DIR="${1:-}"
TARGET_DIR="${2:-}"

if [[ -z "${SOURCE_DIR}" || -z "${TARGET_DIR}" ]]; then
  echo "Usage: $0 <source_dir> <target_dir>"
  exit 1
fi

mkdir -p "${TARGET_DIR}"

if command -v rsync >/dev/null 2>&1; then
  rsync -av --exclude=.git --exclude=node_modules --exclude=.env "${SOURCE_DIR}/" "${TARGET_DIR}/"
else
  cp -R "${SOURCE_DIR}"/* "${TARGET_DIR}/"
  rm -rf "${TARGET_DIR}/.git" "${TARGET_DIR}/node_modules" "${TARGET_DIR}/.env"
fi

cd "${TARGET_DIR}"

if [[ ! -f .gitignore ]]; then
  touch .gitignore
fi

grep -qxF '.env' .gitignore || echo '.env' >> .gitignore
grep -qxF 'node_modules' .gitignore || echo 'node_modules' >> .gitignore
grep -qxF 'dist' .gitignore || echo 'dist' >> .gitignore

echo "Cutover copy created at ${TARGET_DIR}"
echo "Next: git init, add swejobs remote, commit, push."
