#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo '用法：sh create.sh <新的工作区目录>' >&2; exit 1; fi
src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mkdir -p -- "$1"
dest=$(CDPATH='' cd -- "$1" && pwd)
if [ -n "$(ls -A "$dest")" ]; then echo '请选择空目录。' >&2; exit 1; fi
for name in diagram model; do
  if [ "$name" = diagram ]; then title='Two arrows'; else title='Model study'; fi
  npx --yes create-promptframe-component@0.1.73 "$dest" \
    --workspace --component "$name" --display-name "$title"
  cp "$src/$name/Component.tsx" "$src/$name/schema.ts" "$src/$name/preview-props.json" \
    "$dest/components/$name/src/"
done
cp "$src/fixtures/blue.glb" "$dest/components/model/public/blue.glb"
cd "$dest/components/model"
npm pkg set 'dependencies.three=0.175.0' 'devDependencies.@types/three=0.175.0'
