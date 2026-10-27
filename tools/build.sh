#!/bin/sh
# Makes the zip for mod.io: the small build of setup.mjs plus manifest.json.
# Usage: tools/build.sh   (needs Node 20 or newer; the zip lands in dist/)
set -e
cd "$(dirname "$0")/.."
rm -rf dist/pkg && mkdir -p dist/pkg
node --expose-internals tools/minify.cjs setup.mjs dist/pkg/setup.mjs
cp manifest.json dist/pkg/
(cd dist/pkg && zip -q ../township-task-helper.zip manifest.json setup.mjs)
echo "dist/township-task-helper.zip"
