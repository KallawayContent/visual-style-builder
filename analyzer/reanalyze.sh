#!/bin/zsh
# reanalyze.sh ID... -> analyze, repalette, set_plate, style_deep again (the mattes stay). 2026-11-20 (B-roll cards).
SM="${0:A:h:h}"   # the repository folder (works wherever it is unzipped)
[ -f "$SM/.env" ] && source "$SM/.env"   # written by setup.sh: SM_PY, SM_RVM, SM_WHISPER_MODEL
PY="${SM_PY:-$SM/.venv/bin/python}"
RVM="${SM_RVM:-$PY}"
for ID in "$@"; do
  "$PY" "$SM/analyzer/analyze.py" "$ID" 2>&1 | grep -E "inserts|Error|Traceback" | sed "s/^/$ID: /"
  "$PY" "$SM/analyzer/repalette.py" "$ID" > /dev/null 2>&1
  "$PY" "$SM/analyzer/set_plate.py" "$ID" > /dev/null 2>&1
  "$PY" "$SM/analyzer/style_deep.py" "$ID" 2>&1 | grep -E "broll|layout:|Error|Traceback" | sed "s/^/$ID: /"
done
