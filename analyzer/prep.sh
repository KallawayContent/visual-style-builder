#!/bin/zsh
# prep.sh VIDEO ID  -> data/ID/{w.mp4, audio.wav, mattes/, text.jsonl, words.json}
# An upload is read up to its first MAXSEC seconds (the style shows in the first minute; a long video would need GBs of RAM).
# The person matte runs at 15 fps (every other frame); analyze.py holds each matte for two frames.
set -e
SM="${0:A:h:h}"   # the repository folder (works wherever it is unzipped)
[ -f "$SM/.env" ] && source "$SM/.env"   # written by setup.sh: SM_PY, SM_RVM, SM_WHISPER_MODEL
PY="${SM_PY:-$SM/.venv/bin/python}"
RVM="${SM_RVM:-$PY}"
export PATH="$SM/.tools/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"   # ffmpeg / ffprobe: downloaded by setup.sh, or Homebrew's
SRC="$1"; ID="${2:?}"; MAXSEC="${MAXSEC:-60}"
D="$SM/data/$ID"; mkdir -p "$D/mattes"
ffmpeg -v error -y -t "$MAXSEC" -i "$SRC" -vf "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=30" -c:v libx264 -crf 14 -pix_fmt yuv420p -an "$D/w.mp4"
ffmpeg -v error -y -t "$MAXSEC" -i "$SRC" -vn -c:a aac -b:a 192k "$D/audio.m4a" || true
ffmpeg -v error -y -t "$MAXSEC" -i "$SRC" -ar 16000 -ac 1 "$D/audio16.wav" || true
VC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$SRC")
if [[ "$VC" == h264 || "$VC" == hevc ]]; then
  ffmpeg -v error -y -t "$MAXSEC" -i "$SRC" -c copy -an "$D/src_cut.mp4" 2>/dev/null || cp "$SRC" "$D/src_cut.mp4"
else
  ffmpeg -v error -y -t "$MAXSEC" -i "$SRC" -an -c:v libx264 -crf 16 -preset veryfast -pix_fmt yuv420p "$D/src_cut.mp4"
fi
N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/w.mp4")
"$PY" -c "print('\n'.join(str((i+0.5)/30) for i in range(0, $N, 2)))" > "$D/times.txt"
M=$(wc -l < "$D/times.txt" | tr -d ' ')
echo "frames $N"
"$SM/analyzer/textboxes" "$D/src_cut.mp4" 10 "$D/text.jsonl" &
"$SM/analyzer/personmatte" "$D/w.mp4" "$D/mattes" "$D/times.txt" > /dev/null &
PM=$!
if [ -s "$D/audio16.wav" ]; then
  if [[ -n "${SM_WHISPER_MODEL:-}" && -s "$SM_WHISPER_MODEL" ]] && command -v whisper-cli >/dev/null; then   # whisper.cpp (Homebrew)
    whisper-cli -m "$SM_WHISPER_MODEL" -f "$D/audio16.wav" -ml 1 -oj -of "$D/words" > /dev/null 2>&1 &
  else   # faster-whisper in the Python environment (the default setup: no Homebrew needed)
    "$PY" "$SM/analyzer/portable.py" words "$D/audio16.wav" "$D/words.json" > /dev/null 2>&1 &
  fi
else
  echo '{"transcription": []}' > "$D/words.json"
fi
while kill -0 $PM 2>/dev/null; do
  echo "progress mattes $(ls "$D/mattes" | wc -l | tr -d ' ') $M"
  sleep 2
done
wait
echo "prep done $ID"
