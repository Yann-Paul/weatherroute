#!/usr/bin/env bash
# Downloads the BRouter routing segments (.rd5) covering Germany/Austria/
# Switzerland (DACH) from the public brouter.de mirror. Only needed once,
# before starting the local BRouter instance via docker-compose.brouter.yml.
# See: https://brouter.de/brouter/segments4/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../brouter-data/segments4"
BASE_URL="https://brouter.de/brouter/segments4"

# 5x5 degree tiles covering ~5-20E / 45-60N (superset of DACH borders)
TILES=(
  E5_N45 E5_N50 E5_N55
  E10_N45 E10_N50 E10_N55
  E15_N45 E15_N50 E15_N55
)

mkdir -p "$TARGET_DIR"

for tile in "${TILES[@]}"; do
  file="${tile}.rd5"
  dest="$TARGET_DIR/$file"
  if [ -f "$dest" ]; then
    echo "skip $file (already downloaded)"
    continue
  fi
  echo "downloading $file..."
  curl -fSL "$BASE_URL/$file" -o "$dest.tmp" && mv "$dest.tmp" "$dest"
done

echo "Done. Segments in $TARGET_DIR"
