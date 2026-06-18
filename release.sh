#!/usr/bin/env bash

set -e

# Releases are cut by creating a GitHub Release. CI (.github/workflows/ci.yml)
# then stamps the tag's version into every package and publishes the npm + deb
# artifacts. The versions committed in the repo stay at 0.0.0.
#
# Usage: ./release.sh <version>   e.g. ./release.sh 1.3.0

VERSION="$1"
if [ -z "$VERSION" ]; then
	echo "Usage: ./release.sh <version>   (e.g. 1.3.0)" >&2
	exit 1
fi

gh release create "$VERSION" --target main --generate-notes
