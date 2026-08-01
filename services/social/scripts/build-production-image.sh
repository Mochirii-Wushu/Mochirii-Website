#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

image="${PIXELFED_IMAGE:-mochirii-pixelfed:production-check}"
revision="${GITHUB_SHA:-$(git rev-parse HEAD)}"
source_url="https://github.com/Mochirii-Wushu/Mochirii-Website"
current_revision="$(git rev-parse HEAD)"

if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]] || [[ "$revision" != "$current_revision" ]]; then
  echo "The Social image source revision must be the exact checked-out commit." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "The Social image source checkout must be clean before an exact release build." >&2
  exit 1
fi
git cat-file -e "$revision^{commit}"

build_args=(
  docker buildx build
  --load
  --tag "$image"
  --build-arg "MOCHIRII_SOURCE_REVISION=$revision"
  --label "org.opencontainers.image.source=$source_url"
  --label "org.opencontainers.image.revision=$revision"
)

if [[ -n "${BUILD_CACHE_FROM:-}" ]]; then
  build_args+=(--cache-from "$BUILD_CACHE_FROM")
fi
if [[ -n "${BUILD_CACHE_TO:-}" ]]; then
  build_args+=(--cache-to "$BUILD_CACHE_TO")
fi

"${build_args[@]}" .
