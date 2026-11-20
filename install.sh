#!/bin/zsh
# Visual Style Builder: the one-line install for a Mac (macOS 12 or newer). Paste this into Terminal:
#   curl -fsSL https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.sh | zsh
# It needs nothing installed first (no git, no Homebrew, no Xcode tools, no password). It downloads the code into
# ~/visual-style-builder (VSB_DIR=... for another folder), runs setup.sh, then starts the site (NO_START=1 to skip that).
# Running it again updates the code and keeps your analyzed videos (data/) and the downloaded tools.
# (All in one function: the shell reads the whole file before it runs a line, so a program that reads the pipe cannot eat it.)
vsb_install() {
  set -e
  local DIR="${VSB_DIR:-$HOME/visual-style-builder}" TMP
  print -P "%F{cyan}Visual Style Builder: installing into $DIR%f"
  TMP=$(mktemp -d)
  curl -fsSL --retry 3 https://github.com/KallawayContent/visual-style-builder/archive/refs/heads/main.tar.gz | tar -xz -C "$TMP" \
    || { print -P "%F{red}The download did not work.%f Check the internet connection and paste the line again."; return 1; }
  mkdir -p "$DIR"
  cp -R "$TMP"/visual-style-builder-main/. "$DIR"/
  rm -rf "${TMP:?}"
  zsh "$DIR/setup.sh" < /dev/null || return 1
  [[ -n "${NO_START:-}" ]] && return 0
  if [[ -t 1 ]]; then exec zsh "$DIR/start.sh" < /dev/tty; else exec zsh "$DIR/start.sh" < /dev/null; fi
}
vsb_install "$@"
