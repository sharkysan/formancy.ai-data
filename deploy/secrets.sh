#!/bin/sh
# The composed stack's secrets, generated once into the formancy-data-secrets
# volume and kept from then on (0032). compose.yaml's `secrets` service runs
# this, as root in the postgres image the stack pulls anyway, before anything
# that reads one starts.
#
# Why a volume and not `.env` or compose's file secrets: an interpolated value
# shows in `docker compose config` and `docker inspect`, and a host file has to
# be readable by three container users (node 1000, postgres 70, mssql 10001)
# that no host account matches. A volume needs neither, and needs no Node or
# openssl on the operator's machine.
#
# Every file is kept if it holds something; an empty one stops the stack with
# its name, because an empty password is a mistake to report, not to replace
# behind the databases' backs (they were initialised with the old value).
# A new value is `Fd1-` and random letters and digits: the prefix gives SQL
# Server's policy its upper case, lower case, digit and symbol, and the rest is
# letters and digits only, so it survives every shell and T-SQL literal it
# passes through. host-token-secret is longer than the 32 bytes the server's
# verifier requires of an HS256 key.
#
# Names are printed, never values. `docker compose --profile stack down -v`
# deletes the volume, and with it every secret and every token signed by one.
#
# No other service mounts this volume. Each is handed the secrets it reads,
# and no other, in a volume of its own, copied from here on every run: the
# server, which every browser request reaches, and the minter cannot read a
# database administrator's password, so a file-read bug in either does not
# hand one over. A database and its seed share a volume: the administrator's
# password is in it either way, and opens everything the writer's does.
# scripts/getting-started.mjs fails when the server or the minter can read a
# secret its configuration does not name.
set -eu

DIRECTORY=/secrets
# Where compose.yaml mounts each consumer's volume.
HANDED=/handed

# Letters and digits from the kernel's generator. head closes the pipe once it
# has enough, which ends tr; nothing else reads /dev/urandom.
random() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"
}

for name in postgres-owner-password mssql-sa-password pg-writer-password ms-writer-password host-token-secret audit-key; do
  file="$DIRECTORY/$name"
  if [ -e "$file" ]; then
    if [ -s "$file" ]; then
      echo "$name: kept"
      continue
    fi
    echo "$file is empty. Delete the volume with \`docker compose --profile stack down -v\` to start again, or put the value back." >&2
    exit 1
  fi
  length=40
  if [ "$name" = host-token-secret ]; then length=64; fi
  # Written beside its final name and renamed, so a stop halfway through leaves
  # no empty file for the next run to refuse.
  value=$(random "$length")
  if [ "${#value}" -ne "$length" ]; then
    echo "$name: the random generator gave too few characters; nothing was written." >&2
    exit 1
  fi
  umask 077
  printf 'Fd1-%s' "$value" >"$file.new"
  chmod 0444 "$file.new"
  mv "$file.new" "$file"
  echo "$name: generated"
done

# hand CONSUMER NAME...: CONSUMER's volume holds these secrets and nothing
# else. Each is copied beside its final name and renamed, as above; a file
# no longer in the list -- handed by an earlier version of this script -- is
# taken back.
hand() {
  consumer=$1
  shift
  directory="$HANDED/$consumer"
  for name in "$@"; do
    cp "$DIRECTORY/$name" "$directory/$name.new"
    chmod 0444 "$directory/$name.new"
    mv "$directory/$name.new" "$directory/$name"
  done
  for file in "$directory"/* "$directory"/.[!.]*; do
    [ -e "$file" ] || continue
    kept=no
    for name in "$@"; do
      if [ "${file##*/}" = "$name" ]; then kept=yes; fi
    done
    if [ "$kept" = no ]; then rm -f "$file"; fi
  done
  echo "$consumer: handed $*"
}

hand postgres postgres-owner-password pg-writer-password
hand sqlserver mssql-sa-password ms-writer-password
hand server host-token-secret audit-key pg-writer-password ms-writer-password
hand token host-token-secret
