#!/bin/sh
set -eu

duckdns_token=$(cat /etc/duckdns/token)
duckdns_reply=$(curl --fail --silent --show-error --retry 3 --get \
    --data-urlencode 'domains=donald-facturo' \
    --data-urlencode "token=$duckdns_token" \
    https://www.duckdns.org/update)
[ "$duckdns_reply" = OK ] || { echo 'DuckDNS IP update failed' >&2; exit 1; }
