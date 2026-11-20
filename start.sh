#!/bin/zsh
# Start Visual Style Builder: http://127.0.0.1:5190 (PORT=5191 ./start.sh for another port). Stop it with Ctrl+C.
cd "${0:A:h}"
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x $b ]] && eval "$($b shellenv)" && break; done
[[ -d app/node_modules && -f .env ]] || { echo "Run ./setup.sh first."; exit 1; }
cd app && exec npx vite --port "${PORT:-5190}" --strictPort --host 127.0.0.1 --open
