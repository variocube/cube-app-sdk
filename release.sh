#!/usr/bin/env bash

set -e

# Releases are cut by creating a GitHub Release. CI (.github/workflows/ci.yml)
# then stamps the tag's version into every package and publishes the npm
# artifacts. The versions committed in the repo stay at 0.0.0.
#
# Usage: ./release.sh <version> [--prerelease]
#
#   ./release.sh 1.3.0                 a full release: npm dist-tag `latest`,
#                                      demo deployed to GitHub Pages
#   ./release.sh 2.0.0-rc.1 --prerelease
#                                      a release candidate: npm dist-tag `next`,
#                                      no demo deployment

usage() {
	echo "Usage: ./release.sh <version> [--prerelease]   (e.g. 1.3.0, or 2.0.0-rc.1 --prerelease)" >&2
	exit 1
}

VERSION=""
PRERELEASE=false

for arg in "$@"; do
	case "$arg" in
		--prerelease)
			PRERELEASE=true
			;;
		-*)
			echo "Unknown option: $arg" >&2
			usage
			;;
		*)
			if [ -n "$VERSION" ]; then
				echo "Expected a single version, got '$VERSION' and '$arg'" >&2
				usage
			fi
			VERSION="$arg"
			;;
	esac
done

if [ -z "$VERSION" ]; then
	usage
fi

# CI derives the npm dist-tag from the version itself, but the "Latest" badge on
# the release and the demo deployment follow the pre-release flag. Keep the two
# in step, so a candidate cannot be published as the current release by mistake.
if [[ "${VERSION#v}" == *-* ]]; then
	if [ "$PRERELEASE" != true ]; then
		echo "'$VERSION' carries a prerelease identifier; pass --prerelease to release it." >&2
		exit 1
	fi
elif [ "$PRERELEASE" = true ]; then
	echo "'$VERSION' is not a prerelease version; drop --prerelease or use e.g. ${VERSION#v}-rc.1." >&2
	exit 1
fi

if [ "$PRERELEASE" = true ]; then
	gh release create "$VERSION" --target main --generate-notes --prerelease
else
	gh release create "$VERSION" --target main --generate-notes
fi
