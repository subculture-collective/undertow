#!/bin/sh
# Downloads the stem separation model into public/models/, where Vite serves it
# in development and copies it into the build. Its SHA-256 must match
# STEM_MODEL in src/audio/stems.ts. scripts/stems/export-umxhq.py rebuilds the
# same file byte for byte from the published weights.
set -eu
url=https://github.com/subculture-collective/undertow/releases/download/models-umxhq-int8-v1/umxhq-int8.onnx
sha=212eaaa684c8fe8c18f8666d6d05cde1ce8766d8c55d300896d28d950092691d
out=public/models/umxhq-int8.onnx
mkdir -p public/models
hash() { sha256sum "$1" | cut -d ' ' -f 1; }
if [ -f "$out" ] && [ "$(hash "$out")" = "$sha" ]; then exit 0; fi
wget -qO "$out.part" "$url" 2>/dev/null || curl -fsSL -o "$out.part" "$url"
if [ "$(hash "$out.part")" != "$sha" ]; then rm -f "$out.part"; echo "umxhq-int8.onnx: SHA-256 mismatch" >&2; exit 1; fi
mv "$out.part" "$out"
