#!/bin/zsh
# rebuild.sh ID... -> the sharper matte (matte_rvm.py), then analyze, repalette, set_plate, style_deep again (2026-11-20).
SM="${0:A:h:h}"   # the repository folder (works wherever it is unzipped)
[ -f "$SM/.env" ] && source "$SM/.env"   # written by setup.sh: SM_PY, SM_RVM, SM_WHISPER_MODEL
PY="${SM_PY:-$SM/.venv/bin/python}"
RVM="${SM_RVM:-$PY}"
for ID in "$@"; do
  echo "== $ID $(date +%T)"
  "$RVM" "$SM/analyzer/matte_rvm.py" "$ID" 2>/dev/null | tail -1
  "$PY" "$SM/analyzer/analyze.py" "$ID" > /dev/null 2>&1 || { echo "FAIL analyze $ID"; continue; }
  "$PY" "$SM/analyzer/repalette.py" "$ID" > /dev/null 2>&1
  "$PY" "$SM/analyzer/set_plate.py" "$ID" > /dev/null 2>&1
  "$PY" "$SM/analyzer/style_deep.py" "$ID" > /dev/null 2>&1 || echo "FAIL style $ID"
  echo "ok $ID $(date +%T)"
done
