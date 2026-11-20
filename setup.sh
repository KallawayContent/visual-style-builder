#!/bin/zsh
# Visual Style Builder: one-time setup (macOS 12 or newer). Safe to run again: every step skips what is already done.
# It needs NOTHING installed first: no Homebrew, no Xcode or developer tools, no git, no password. It downloads its own copies
# of Python, Node.js and FFmpeg into .tools/ (inside this folder), so deleting the folder removes everything.
#   ./setup.sh                        the full version (about 3 GB: + PyTorch for the sharper person cut-out)
#   LITE=1 ./setup.sh                 no PyTorch (about 1.5 GB): the person cut-out comes from Apple Vision only (softer edges)
#   WHISPER_MODEL=small.en ./setup.sh a bigger speech model for more exact word timing (default: base.en)
set -e
cd "${0:A:h}"
ROOT="$PWD"
T="$ROOT/.tools"
mkdir -p "$T/bin"
export PATH="$T/bin:$T/node/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$T/python" UV_PYTHON_PREFERENCE=only-managed   # never the system python3 (on a Mac with no developer tools it opens Apple's install window)
REPO="https://github.com/KallawayContent/visual-style-builder"
TOOLS_TAG="mac-tools-v1"
step() { print -P "\n%F{cyan}==> $1%f"; }
ok()   { print -P "    %F{green}ok%f $1"; }
warn() { print -P "    %F{yellow}$1%f"; }
fail() { print -P "\n%F{red}SETUP STOPPED:%f $1\n"; exit 1; }
sha_ok() { [[ "$(shasum -a 256 "$1" | cut -d' ' -f1)" == "$2" ]]; }

step "1/7 This computer"
[[ "$(uname)" == Darwin ]] || fail "This script is for macOS. On Windows run setup.cmd; on Linux see AGENT_SETUP.md."
V=$(sw_vers -productVersion); [[ ${V%%.*} -ge 12 ]] || fail "macOS $V is too old: macOS 12 (Monterey) or newer is needed."
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" == 1 ]]; then ARCH=arm64; else ARCH=x86_64; fi
if [[ $ARCH == x86_64 && -z "${LITE:-}" ]]; then LITE=1; warn "an Intel Mac: the lite version (PyTorch has no current builds for Intel Macs)"; fi
FREE=$(df -g "$ROOT" | awk 'NR==2 {print $4}')
[[ ${FREE:-99} -ge 4 ]] || fail "Only ${FREE} GB free on this disk. The setup needs about 4 GB."
xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true   # a folder downloaded with a browser: let its programs run
ok "macOS $V, $ARCH, ${FREE} GB free"

step "2/7 FFmpeg + the Apple Vision tools (one download, about 60 MB)"
VISION=(personmatte textboxes visiontags rects)
have_tools() { [[ -x "$T/bin/ffmpeg" && -x "$T/bin/ffprobe" ]] && "$T/bin/ffmpeg" -version >/dev/null 2>&1 && for t in $VISION; do [[ -x analyzer/$t ]] || return 1; done; }
if have_tools; then ok "already here"
else
  typeset -A SHA=(arm64 b23862e3dd8e938c7ecf3567358715ad776c0731996d64e36e219969ba939393 x86_64 f3b3a3966a7e59c5c0b8ef7a9d8dce011cc442cb6ab99f2bad3538b613a40773)
  PKG="$T/vsb-mac-tools-$ARCH.tar.gz"
  curl -fL --progress-bar --retry 3 -o "$PKG" "$REPO/releases/download/$TOOLS_TAG/vsb-mac-tools-$ARCH.tar.gz" || fail "The download did not work. Check the internet connection and run the setup again."
  sha_ok "$PKG" "${SHA[$ARCH]}" || fail "The downloaded tools file is damaged (wrong checksum). Run the setup again."
  mkdir -p "$T/pkg" && tar -xzf "$PKG" -C "$T/pkg"
  cp "$T/pkg/bin/ffmpeg" "$T/pkg/bin/ffprobe" "$T/bin/" && cp "$T/pkg/NOTICE.txt" "$T/"
  for t in $VISION; do cp "$T/pkg/analyzer/$t" "analyzer/$t"; done
  chmod +x "$T/bin/ffmpeg" "$T/bin/ffprobe" analyzer/${^VISION}
  rm -rf "$T/pkg" "$PKG"
  have_tools || fail "FFmpeg or an Apple Vision tool does not run on this Mac. See AGENT_SETUP.md, Troubleshooting."
  ok "ffmpeg, ffprobe, analyzer/{${(j:,:)VISION}}"
fi

step "3/7 Python 3.12 (a private copy in .tools/)"
if [[ ! -x "$T/bin/uv" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$T/bin" sh >/dev/null 2>&1 || fail "uv (the Python installer) did not download. Check the internet connection and run the setup again."
fi
if ! .venv/bin/python -c "import sys" >/dev/null 2>&1; then
  rm -rf .venv
  uv venv -q --python 3.12 .venv || fail "Python 3.12 did not install (uv venv). Run the setup again."
fi
ok "$(.venv/bin/python --version)"

step "4/7 Python libraries (OpenCV, faster-whisper, yt-dlp$([[ -z "${LITE:-}" ]] && print ', PyTorch: about 1 GB'))"
uv pip install -q --python .venv/bin/python -r requirements.txt || fail "The Python libraries did not install (see the error above). Run the setup again."
if [[ -z "${LITE:-}" ]]; then
  uv pip install -q --python .venv/bin/python torch torchvision || fail "PyTorch did not install. Run  LITE=1 ./setup.sh  to skip it."
fi
ok "the libraries$([[ -n "${LITE:-}" ]] && print ' (lite: no PyTorch)')"

step "5/7 Node.js (a private copy in .tools/)"
if [[ -x "$T/node/bin/node" ]]; then ok "node $("$T/node/bin/node" --version)"
else
  NA=$([[ $ARCH == arm64 ]] && print arm64 || print x64)
  SUMS=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt) || fail "nodejs.org did not answer. Check the internet connection and run the setup again."
  LINE=$(print -r -- "$SUMS" | grep " node-v.*-darwin-$NA.tar.gz$" | head -1)
  NSHA=${LINE%% *}; NF=${LINE##* }
  curl -fL --progress-bar --retry 3 -o "$T/$NF" "https://nodejs.org/dist/latest-v22.x/$NF" || fail "Node.js did not download. Run the setup again."
  sha_ok "$T/$NF" "$NSHA" || fail "The Node.js download is damaged (wrong checksum). Run the setup again."
  mkdir -p "$T/node" && tar -xzf "$T/$NF" -C "$T/node" --strip-components 1 && rm -f "$T/$NF"
  "$T/node/bin/node" --version >/dev/null || fail "Node.js does not run on this Mac."
  ok "node $("$T/node/bin/node" --version)"
fi

step "6/7 The models (speech$([[ -z "${LITE:-}" ]] && print ' + the person cut-out'))"
export SM_WHISPER="${WHISPER_MODEL:-base.en}"
if .venv/bin/python analyzer/portable.py warmup mac; then ok "models"
else warn "a model did not download now. It downloads again on the first video (check the internet connection)."; fi

step "7/7 The web app"
(cd app && npm ci --no-audit --no-fund --loglevel=error) || fail "npm ci failed (see the error above). Run the setup again."
mkdir -p data uploads app/public
[[ -L app/public/data ]] || ln -s ../../data app/public/data
print -r -- "SM_PY=\"$ROOT/.venv/bin/python\"" > .env
print -r -- "SM_WHISPER=\"$SM_WHISPER\"" >> .env
LAUNCHER="$ROOT/Start Visual Style Builder.command"
print -r -- "#!/bin/zsh
exec \"$ROOT/start.sh\"" > "$LAUNCHER"
chmod +x "$LAUNCHER"
[[ -d "$HOME/Desktop" ]] && cp "$LAUNCHER" "$HOME/Desktop/" 2>/dev/null && ok "a start icon on the Desktop: Start Visual Style Builder.command" || true
ok "app/node_modules, data/, .env"

print -P "\n%F{green}Setup is done.%f Start the site with:  ./start.sh   (or double-click \"Start Visual Style Builder\" on the Desktop)\n"
