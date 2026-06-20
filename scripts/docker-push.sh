#!/usr/bin/env bash
#
# Build and push the Docker image to the test or production registry.
#
# Usage:
#   scripts/docker-push.sh <test|prod>
#
# Tags applied: <version> (from package.json), <git-short-sha>, latest
#
# Environment overrides:
#   IMAGE_NAME   Image repository path        (default: dify-discord-starter)
#   PLATFORM     Target build platform        (default: linux/amd64)
#   DRY_RUN      If "1", build but do NOT push (default: 0)
#
# Prerequisite: run `docker login <registry>` once before pushing.

set -euo pipefail

# --- registries ---------------------------------------------------------------
readonly REGISTRY_PROD="registry.oshiire.to"
readonly REGISTRY_TEST="registry.test.oshiire.to"

# --- locate repo root (script lives in scripts/) ------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SCRIPT_DIR REPO_ROOT

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <test|prod>

  test   push to ${REGISTRY_TEST}
  prod   push to ${REGISTRY_PROD}

Tags: <version>, <git-short-sha>, latest
Env:  IMAGE_NAME (default dify-discord-starter), PLATFORM (default linux/amd64), DRY_RUN (0/1)
EOF
  exit 2
}

# --- validate argument --------------------------------------------------------
[[ $# -eq 1 ]] || usage

case "$1" in
  prod) REGISTRY="${REGISTRY_PROD}" ;;
  test) REGISTRY="${REGISTRY_TEST}" ;;
  -h|--help) usage ;;
  *) echo "error: target must be 'test' or 'prod' (got '$1')" >&2; usage ;;
esac

readonly TARGET="$1"
readonly IMAGE_NAME="${IMAGE_NAME:-dify-discord-starter}"
readonly PLATFORM="${PLATFORM:-linux/amd64}"
readonly DRY_RUN="${DRY_RUN:-0}"
readonly IMAGE_REF="${REGISTRY}/${IMAGE_NAME}"

# --- derive tags --------------------------------------------------------------
VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain)" ]]; then
  echo "warning: working tree is dirty; tagging SHA as '${SHA}-dirty'" >&2
  SHA="${SHA}-dirty"
fi
readonly VERSION SHA

# --- assemble docker tag flags ------------------------------------------------
TAGS=("${VERSION}" "${SHA}" "latest")
tag_flags=()
for t in "${TAGS[@]}"; do
  tag_flags+=("--tag" "${IMAGE_REF}:${t}")
done

echo "==> Target:    ${TARGET} (${REGISTRY})"
echo "==> Image:     ${IMAGE_REF}"
echo "==> Tags:      ${TAGS[*]}"
echo "==> Platform:  ${PLATFORM}"
echo "==> Dry run:   ${DRY_RUN}"

# --- build & push -------------------------------------------------------------
# buildx --push builds and uploads in one step (reliable for cross-platform).
# Without --push (dry run) buildx still performs the full build, validating it.
build_args=(buildx build --platform "${PLATFORM}" "${tag_flags[@]}")
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "==> DRY RUN: building only, not pushing"
else
  build_args+=("--push")
fi
build_args+=("${REPO_ROOT}")

if ! docker "${build_args[@]}"; then
  echo "error: docker build/push failed." >&2
  echo "       if this is an auth error, run: docker login ${REGISTRY}" >&2
  exit 1
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "==> Dry run complete (nothing pushed)."
else
  echo "==> Pushed ${IMAGE_REF} [${TAGS[*]}]"
fi
