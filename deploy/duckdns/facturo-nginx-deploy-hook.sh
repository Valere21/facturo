#!/bin/sh
set -eu

case "${RENEWED_LINEAGE:-}" in
    /etc/letsencrypt/live/donald-facturo.duckdns.org)
        /usr/bin/systemctl reload nginx
        ;;
esac
