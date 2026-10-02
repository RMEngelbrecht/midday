#!/bin/sh
# Shared Docker entrypoint for all services.
# Sets GIT_COMMIT_SHA and SENTRY_RELEASE from the build-time stamp file when
# they aren't provided at runtime. Runtime config is validated by `varlock run`
# in each image's CMD.

GIT_COMMIT_SHA="${GIT_COMMIT_SHA:-$(cat /tmp/git-sha.txt 2>/dev/null || echo "")}"
export GIT_COMMIT_SHA

SENTRY_RELEASE="${SENTRY_RELEASE:-$GIT_COMMIT_SHA}"
export SENTRY_RELEASE

exec "$@"
