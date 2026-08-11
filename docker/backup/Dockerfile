# syntax=docker/dockerfile:1.17@sha256:38387523653efa0039f8e1c89bb74a30504e76ee9f565e25c9a09841f9427b05

ARG ALPINE_IMAGE=alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40
ARG GO_IMAGE=golang:1.25.12-alpine3.23@sha256:cc985ef6f9c3bf9ece7488129c9abe0a150388ccdfa428d886fc709dca0b230a

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS age-build
ARG TARGETARCH
ADD --checksum=sha256:396007bc0bc53de253391493bda1252757ba63af1a19db86cfb60a35cb9d290a \
  https://github.com/FiloSottile/age/archive/refs/tags/v1.3.1.tar.gz \
  /tmp/age.tar.gz
RUN mkdir -p /src /out \
    && tar -xzf /tmp/age.tar.gz --strip-components=1 -C /src \
    && cd /src \
    && go get golang.org/x/crypto@v0.52.0 golang.org/x/text@v0.39.0 \
    && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
      go build -trimpath -ldflags='-s -w -X main.Version=v1.3.1' \
      -o /out/age ./cmd/age

FROM ${ALPINE_IMAGE} AS tools-amd64
ADD --checksum=sha256:aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa \
  https://downloads.rclone.org/v1.75.0/rclone-v1.75.0-linux-amd64.zip \
  /tmp/rclone.zip
RUN mkdir -p /out \
    && unzip -q /tmp/rclone.zip -d /tmp \
    && install -m 0555 /tmp/rclone-v1.75.0-linux-amd64/rclone /out/rclone
COPY --from=age-build /out/age /out/age

FROM ${ALPINE_IMAGE} AS tools-arm64
ADD --checksum=sha256:d0ad88ba4c8e285b7c9efa591e0ab643280a91741e13c27f3a9c0957ccfa5203 \
  https://downloads.rclone.org/v1.75.0/rclone-v1.75.0-linux-arm64.zip \
  /tmp/rclone.zip
RUN mkdir -p /out \
    && unzip -q /tmp/rclone.zip -d /tmp \
    && install -m 0555 /tmp/rclone-v1.75.0-linux-arm64/rclone /out/rclone
COPY --from=age-build /out/age /out/age

ARG TARGETARCH
FROM tools-${TARGETARCH} AS tools

FROM ${ALPINE_IMAGE}

ARG POSTGRESQL_CLIENT_VERSION=17.10-r0
ARG CA_CERTIFICATES_VERSION=20260611-r0
ARG LIBPQ_VERSION=18.4-r0
ARG LIBNCURSESW_VERSION=6.5_p20251123-r0
ARG LZ4_LIBS_VERSION=1.10.0-r0
ARG NCURSES_TERMINFO_BASE_VERSION=6.5_p20251123-r0
ARG POSTGRESQL_COMMON_VERSION=1.2-r2
ARG READLINE_VERSION=8.3.1-r0
ARG TZDATA_VERSION=2026c-r0
ARG ZSTD_LIBS_VERSION=1.5.7-r2

RUN apk add --no-cache \
      "ca-certificates=${CA_CERTIFICATES_VERSION}" \
      "libncursesw=${LIBNCURSESW_VERSION}" \
      "libpq=${LIBPQ_VERSION}" \
      "lz4-libs=${LZ4_LIBS_VERSION}" \
      "ncurses-terminfo-base=${NCURSES_TERMINFO_BASE_VERSION}" \
      "postgresql-common=${POSTGRESQL_COMMON_VERSION}" \
      "postgresql17-client=${POSTGRESQL_CLIENT_VERSION}" \
      "readline=${READLINE_VERSION}" \
      "tzdata=${TZDATA_VERSION}" \
      "zstd-libs=${ZSTD_LIBS_VERSION}" \
    && addgroup -S -g 10001 backup \
    && adduser -S -D -H -u 10001 -G backup backup \
    && install -d -m 0755 /opt/backup \
    && install -d -m 0700 -o backup -g backup \
      /var/lib/backup \
      /var/lib/backup/.config \
      /var/lib/backup/work \
    && rm -f /sbin/apk

COPY --from=tools /out/age /usr/local/bin/age
COPY --from=tools /out/rclone /usr/local/bin/rclone
COPY --chmod=0555 check-tools.sh /opt/backup/check-tools.sh

ENV HOME=/var/lib/backup \
    XDG_CONFIG_HOME=/var/lib/backup/.config

LABEL org.opencontainers.image.title="Quandatics encrypted backup runtime" \
  org.opencontainers.image.description="Source-free PostgreSQL backup, age encryption, and R2 upload runtime" \
  org.opencontainers.image.source="https://github.com/Quandatics-Malaysia/crm-v2" \
  com.quandatics.postgresql-client.version="17.10-r0" \
  com.quandatics.age.version="1.3.1" \
  com.quandatics.rclone.version="1.75.0"

WORKDIR /var/lib/backup/work
USER 10001:10001
CMD ["sleep", "infinity"]
