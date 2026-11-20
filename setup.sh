#!/bin/zsh
# Visual Style Builder: one-time setup (macOS). Safe to run again: every step skips what is already done.
#   ./setup.sh                 the full version (about 2.5 GB: Python + PyTorch, the sharper person cut-out, a small speech model)
#   LITE=1 ./setup.sh          no PyTorch (about 1 GB): the person cut-out comes from Apple Vision only (softer edges)
#   WHISPER_MODEL=large-v3-turbo ./setup.sh    a bigger speech model (1.6 GB) for more exact word timing (default: base.en, 142 MB)
set -e
cd "${0:A:h}"
ROOT="$PWD"
step() { print -P "\n%F{cyan}==> $1%f"; }
ok()   { print -P "    %F{green}ok%f $1"; }
fail() { print -P "\n%F{red}SETUP STOPPED:%f $1\n"; exit 1; }

step "1/8 This computer"
[[ "$(uname)" == Darwin ]] || fail "This version runs on macOS only (it uses Apple's Vision framework for the person cut-out and the text reading)."
ok "macOS $(sw_vers -productVersion) on $(uname -m)"

step "2/8 Apple command line tools (for the Swift tools)"
xcode-select -p >/dev/null 2>&1 || fail "Apple's command line tools are missing. Run:  xcode-select --install   finish the window that opens, then run ./setup.sh again."
command -v swiftc >/dev/null || fail "swiftc was not found. Run:  xcode-select --install   then ./setup.sh again."
ok "$(swiftc --version 2>&1 | head -1)"

step "3/8 Homebrew packages: ffmpeg, yt-dlp, whisper-cpp, node"
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x $b ]] && eval "$($b shellenv)" && break; done
command -v brew >/dev/null || fail "Homebrew is missing. Install it from https://brew.sh (it asks for your password), then run ./setup.sh again."
for p in ffmpeg yt-dlp whisper-cpp node; do
  if brew list --formula "$p" >/dev/null 2>&1; then ok "$p"; else print "    installing $p ..."; brew install "$p" >/dev/null || fail "brew install $p failed."; ok "$p"; fi
done

step "4/8 Python environment (.venv)"
PYBIN=""
for c in python3.13 python3.12 python3.11 python3 ; do
  if command -v $c >/dev/null && $c -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then PYBIN=$(command -v $c); break; fi
done
if [[ -z "$PYBIN" ]]; then print "    installing python@3.12 ..."; brew install python@3.12 >/dev/null; PYBIN="$(brew --prefix python@3.12)/bin/python3.12"; fi
[[ -x .venv/bin/python ]] || "$PYBIN" -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt || fail "pip install -r requirements.txt failed."
if [[ -z "${LITE:-}" ]]; then
  print "    installing PyTorch (about 1 GB, a few minutes) ..."
  .venv/bin/python -m pip install -q torch torchvision || fail "PyTorch did not install. Run  LITE=1 ./setup.sh  to skip it."
fi
ok "$(.venv/bin/python --version)$([[ -n "${LITE:-}" ]] && print ' (lite: no PyTorch)')"

step "5/8 The Swift tools (Apple Vision: person cut-out, text, labels, rectangles)"
for t in personmatte textboxes visiontags rects; do
  if [[ ! -x analyzer/$t || analyzer/$t.swift -nt analyzer/$t ]]; then swiftc -O "analyzer/$t.swift" -o "analyzer/$t" 2>&1 | tail -3; fi
  [[ -x analyzer/$t ]] || fail "analyzer/$t did not build."
  ok "analyzer/$t"
done

step "6/8 Speech model (word timing)"
MODEL="${WHISPER_MODEL:-base.en}"; MF="models/ggml-$MODEL.bin"; mkdir -p models
if [[ ! -s "$MF" ]]; then
  print "    downloading $MF ..."
  curl -L --fail --progress-bar -o "$MF.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin" && mv "$MF.part" "$MF" || fail "The speech model did not download."
fi
ok "$MF"

step "7/8 The sharper person cut-out (Robust Video Matting weights)"
if [[ -n "${LITE:-}" ]]; then ok "skipped (lite)"
else
  SSL_CERT_FILE=/etc/ssl/cert.pem .venv/bin/python -c "import torch; torch.hub.load('PeterL1n/RobustVideoMatting', 'resnet50', trust_repo=True, skip_validation=True)" >/dev/null 2>&1 \
    && ok "downloaded" || print -P "    %F{yellow}not downloaded now (it tries again on the first video; without it the cut-out is Apple Vision's)%f"
fi

step "8/8 The web app"
(cd app && npm ci --no-audit --no-fund --loglevel=error) || fail "npm ci failed."
mkdir -p data uploads app/public
[[ -L app/public/data ]] || ln -s ../../data app/public/data
cat > .env <<ENV
SM_PY="$ROOT/.venv/bin/python"
SM_WHISPER_MODEL="$ROOT/$MF"
ENV
ok "app/node_modules, data/, .env"

print -P "\n%F{green}Setup is done.%f Start the site with:  ./start.sh\n"
