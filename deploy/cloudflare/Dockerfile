# The tools of deploy/cloudflare/compose.yaml (0037): Node, to run setup.mjs,
# configure.mjs and check.mjs from the checkout, and the cloudflared binary
# copied out of the very image the `cloudflared` service runs, so the binary
# that checks the tunnel's configuration is the one that runs it. The two
# references -- this FROM and the overlay's `image:` -- are one tag and one
# digest, and scripts/cloudflare/gate.mjs fails the CI job `cloudflare` when
# they differ.
#
# Built locally under a local tag, never pulled and never published. It holds
# none of this repository's code: the scripts are mounted read-only from the
# checkout, so the tools run what the checkout says.

FROM cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07 AS cloudflared

# The data server's own base (packages/data-server/Dockerfile).
FROM node:22.12-alpine

# A static binary (`ldd`: "not a dynamic executable", measured 2026-10-11 on
# 2026.10.0), so it runs on alpine as it does on the image's distroless base;
# the build fails here if that stops being so.
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN cloudflared --version
