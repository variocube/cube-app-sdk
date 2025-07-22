#!/usr/bin/env bash

set -e

# Check whether this script was called with the build-package argument
if [ "$1" = "build-package" ]
then
  # We are running within the container
  cd /work && dpkg-buildpackage -us -uc && mv /variocube-* /work/dpkg
else
  # The architectures to build
  archs=${*:-amd64}

  # Ensure a clean output directory
  mkdir -p dpkg
  rm -rf dpkg/*

  # Run build for each arch in separate container
  for arch in $archs
  do
    docker run --rm --privileged \
      --platform "linux/$arch" \
      --pull always \
      --volume "$(pwd):/work" \
      --name "cube-app-service-build-$arch" \
      ghcr.io/variocube/debian-build /work/build_debian.sh build-package
  done
fi


