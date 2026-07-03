#!/usr/bin/env bash
# Package a built .app into a compressed DMG using only hdiutil.
#
# Tauri's own DMG bundler (bundle_dmg.sh) drives Finder via AppleScript to lay
# out the disk-image window, which hangs for ~20 minutes and then fails on the
# headless GitHub macOS runners (no logged-in GUI session). `hdiutil create` is a
# pure command-line operation, so it works on CI. The .app inside keeps its
# ad-hoc signature from `tauri build --bundles app`.
set -euo pipefail

TARGET="${1:?usage: make-macos-dmg.sh <target-triple> [volume-name]}"
VOLNAME="${2:-FrameQ}"

BUNDLE_DIR="app/src-tauri/target/${TARGET}/release/bundle"
APP="${BUNDLE_DIR}/macos/${VOLNAME}.app"
if [ ! -d "${APP}" ]; then
  echo "App bundle not found: ${APP}" >&2
  exit 1
fi

if find "${APP}/Contents/Resources/resources" \( -name __pycache__ -o -name '*.pyc' \) | grep -q .; then
  echo "Refusing to package ${APP}: Python bytecode cache files would invalidate the signed app bundle." >&2
  find "${APP}/Contents/Resources/resources" \( -name __pycache__ -o -name '*.pyc' \) >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=4 "${APP}"

case "${TARGET}" in
  x86_64-apple-darwin) ARCH_SUFFIX="x64" ;;
  aarch64-apple-darwin) ARCH_SUFFIX="aarch64" ;;
  *) ARCH_SUFFIX="${TARGET}" ;;
esac

VERSION="$(node -p "require('./app/src-tauri/tauri.conf.json').version")"
DMG_DIR="${BUNDLE_DIR}/dmg"
DMG="${DMG_DIR}/${VOLNAME}_${VERSION}_${ARCH_SUFFIX}.dmg"
mkdir -p "${DMG_DIR}"
rm -f "${DMG}"

STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT
# ditto preserves bundle metadata and the code signature.
ditto "${APP}" "${STAGING}/${VOLNAME}.app"
ln -s /Applications "${STAGING}/Applications"

hdiutil create \
  -volname "${VOLNAME}" \
  -srcfolder "${STAGING}" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "${DMG}"

echo "Created ${DMG}"
