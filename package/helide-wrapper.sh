#!/usr/bin/env bash
# Copyright 2025 The Helium Authors
# You can use, redistribute, and/or modify this source code under
# the terms of the GPL-3.0 license that can be found in the LICENSE file.

# Replace when packaging, so that we can easily determine which
# distro the user is using if they open a bug report.
export CHROME_VERSION_EXTRA="Helide: personal Linux build for Motobook 60 Pro"

# Let the wrapped binary know that it has been run through the wrapper.
CHROME_WRAPPER="$(readlink -f "$0")"
HERE="$(dirname "$CHROME_WRAPPER")"

# Flags from /etc/helide-browser-flags.conf, then
# $XDG_CONFIG_HOME/helide-browser-flags.conf, then $HELIDE_USER_FLAGS.
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-"$HOME/.config"}"

SYS_CONF="/etc/helide-browser-flags.conf"
USR_CONF="${XDG_CONFIG_HOME}/helide-browser-flags.conf"

FLAGS=()

append_flags_file() {
  local file="$1"
  [[ -r "$file" ]] || return 0
  local line safe_line
  # Filter comments & blank lines
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    # Sanitise: block command substitution; prevent $VAR and ~ expansion
    case "$line" in
      *\$\(*|*\`*)
        echo "Warning: ignoring unsafe line in $file: $line" >&2
        continue
        ;;
    esac
    # Disable globbing during eval
    set -f
    # Prevent $VAR and ~ expansion while allowing eval to parse quotes & escapes
    safe_line=${line//$/\\$}
    safe_line=${safe_line//~/\\~}
    eval "set -- $safe_line"
    # Enable globbing for rest of the script
    set +f
    for token in "$@"; do
      FLAGS+=("$token")
    done
  done < "$file"
}

append_flags_file "$SYS_CONF"
append_flags_file "$USR_CONF"

# $HELIDE_USER_FLAGS ($HELIUM_USER_FLAGS from before the rename still works).
USER_FLAGS="${HELIDE_USER_FLAGS:-${HELIUM_USER_FLAGS:-}}"
if [[ -n "$USER_FLAGS" ]]; then
  # Split env contents on whitespace; users can quote if needed.
  read -r -a ENV_FLAGS <<< "$USER_FLAGS"
  FLAGS+=("${ENV_FLAGS[@]}")
fi

export CHROME_WRAPPER
export LD_LIBRARY_PATH="$HERE:$HERE/lib:$HERE/lib.target${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

# Sanitize std{in,out,err} because they'll be shared with untrusted child
# processes (http://crbug.com/376567).
exec < /dev/null
exec > >(exec cat)
exec 2> >(exec cat >&2)

exec "$HERE/helide" "${FLAGS[@]}" "$@"
