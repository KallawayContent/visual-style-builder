#!/bin/zsh
# Start Visual Style Builder: http://127.0.0.1:5190 (PORT=5191 ./start.sh for another port). Stop it with Ctrl+C or close the window.
cd "${0:A:h}"
export PATH="$PWD/.tools/bin:$PWD/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[[ -d app/node_modules && -f .env ]] || { echo "Run ./setup.sh first."; exit 1; }
URL="http://127.0.0.1:${PORT:-5190}"
if curl -s -o /dev/null --max-time 2 "$URL/api/videos"; then echo "Visual Style Builder is already running: $URL"; open "$URL"; exit 0; fi
echo "Visual Style Builder: $URL  (keep this window open while you use the site)"
cd app && exec npx vite --port "${PORT:-5190}" --strictPort --host 127.0.0.1 --open
