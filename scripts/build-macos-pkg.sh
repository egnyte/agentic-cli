#!/usr/bin/env bash
set -euo pipefail

VERSION=$1
ARCH=$2   # x64 or arm64

BINARY="dist/binaries/egnyte-macos-${ARCH}"
PKG_ROOT="dist/pkg-root-${ARCH}"
OUT="dist/installers/egnyte-v${VERSION}-${ARCH}.pkg"

mkdir -p "$PKG_ROOT/usr/local/bin" dist/installers

cp "$BINARY" "$PKG_ROOT/usr/local/bin/egnyte"
chmod +x "$PKG_ROOT/usr/local/bin/egnyte"

pkgbuild \
  --identifier com.egnyte.cli \
  --version "$VERSION" \
  --root "$PKG_ROOT" \
  --install-location / \
  "$OUT"

echo "Built: $OUT"
