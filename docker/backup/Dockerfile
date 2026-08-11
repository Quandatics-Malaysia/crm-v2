# syntax=docker/dockerfile:1.17@sha256:38387523653efa0039f8e1c89bb74a30504e76ee9f565e25c9a09841f9427b05

ARG ALPINE_IMAGE=alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

FROM ${ALPINE_IMAGE} AS tools-amd64
ADD --checksum=sha256:bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377 \
  https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz \
  /tmp/age.tar.gz
ADD --checksum=sha256:72a806370072015ccbe4d81bcd348cc5eaf3beca6c65ba693fd43fb31fcca5b1 \
  https://downloads.rclone.org/v1.74.2/rclone-v1.74.2-linux-amd64.zip \
  /tmp/rclone.zip
RUN mkdir -p /out \
    && tar -xzf /tmp/age.tar.gz -C /tmp \
    && unzip -q /tmp/rclone.zip -d /tmp \
    && install -m 0555 /tmp/age/age /out/age \
    && install -m 0555 /tmp/rclone-v1.74.2-linux-amd64/rclone /out/rclone

FROM ${ALPINE_IMAGE} AS tools-arm64
ADD --checksum=sha256:c6878a324421b69e3e20b00ba17c04bc5c6dab0030cfe55bf8f68fa8d9e9093a \
  https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-arm64.tar.gz \
  /tmp/age.tar.gz
ADD --checksum=sha256:bc2b2eb8269b743ed7bcea869f3782cfb4931e41efa53fc8befc6dc8308b7a50 \
  https://downloads.rclone.org/v1.74.2/rclone-v1.74.2-linux-arm64.zip \
  /tmp/rclone.zip
RUN mkdir -p /out \
    && tar -xzf /tmp/age.tar.gz -C /tmp \
    && unzip -q /tmp/rclone.zip -d /tmp \
    && install -m 0555 /tmp/age/age /out/age \
    && install -m 0555 /tmp/rclone-v1.74.2-linux-arm64/rclone /out/rclone

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
  com.quandatics.rclone.version="1.74.2"

WORKDIR /var/lib/backup/work
USER 10001:10001
CMD ["sleep", "infinity"]
