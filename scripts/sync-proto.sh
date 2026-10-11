#!/usr/bin/env sh
# Copies the Forge API's protos from a checkout of showmino/forge and
# regenerates the TypeScript client. Run: sh scripts/sync-proto.sh ../forge
set -eu
src=${1:?usage: sync-proto.sh <path to a forge checkout>}
here=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$here/proto/forge"
mkdir -p "$here/proto/forge/v1"
cp "$src"/proto/forge/v1/*.proto "$here/proto/forge/v1/"
git -C "$src" rev-parse HEAD > "$here/proto/FORGE_COMMIT"
cd "$here" && npm run generate
