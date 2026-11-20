"""prep.py VIDEO ID -> data/ID/{w.mp4, audio.m4a, audio16.wav, src_cut.mp4, times.txt, text.jsonl, mattes/, words.json}
The portable twin of prep.sh (Windows, Linux, or a Mac with SM_PORTABLE=1): the same files, made with ffmpeg + analyzer/portable.py
instead of the Apple tools. The text reading, the person matte and the word timings run at the same time; the person matte reports
"progress mattes n m" (the page's progress bar)."""
import os, subprocess, sys, time

SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, ID = sys.argv[1], sys.argv[2]
MAXSEC = os.environ.get("MAXSEC", "60")
D = os.path.join(SM, "data", ID)
os.makedirs(os.path.join(D, "mattes"), exist_ok=True)
PY = sys.executable
PORT = os.path.join(SM, "analyzer", "portable.py")


def ff(*a, check=True):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-t", MAXSEC, "-i", SRC, *a])
    if check and r.returncode:
        sys.exit(f"error prep: ffmpeg {' '.join(a[-1:])}")
    return r.returncode


ff("-vf", "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=30", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-an",
   os.path.join(D, "w.mp4"))
ff("-vn", "-c:a", "aac", "-b:a", "192k", os.path.join(D, "audio.m4a"), check=False)
ff("-ar", "16000", "-ac", "1", os.path.join(D, "audio16.wav"), check=False)
vc = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", SRC],
                    capture_output=True, text=True).stdout.strip()
if vc in ("h264", "hevc"):
    if ff("-c", "copy", "-an", os.path.join(D, "src_cut.mp4"), check=False):
        import shutil; shutil.copy(SRC, os.path.join(D, "src_cut.mp4"))
else:
    ff("-an", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", os.path.join(D, "src_cut.mp4"))
N = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                        "-of", "csv=p=0", os.path.join(D, "w.mp4")], capture_output=True, text=True).stdout.strip() or 0)
times = [(i + 0.5) / 30 for i in range(0, N, 2)]
open(os.path.join(D, "times.txt"), "w").write("\n".join(str(t) for t in times) + "\n")
print(f"frames {N}", flush=True)

quiet = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
jobs = [subprocess.Popen([PY, PORT, "textboxes", os.path.join(D, "src_cut.mp4"), "5", os.path.join(D, "text.jsonl")], **quiet)]
pm = subprocess.Popen([PY, PORT, "personmatte", os.path.join(D, "w.mp4"), os.path.join(D, "mattes"), os.path.join(D, "times.txt")], **quiet)
a16 = os.path.join(D, "audio16.wav")
if os.path.exists(a16) and os.path.getsize(a16) > 1000:
    jobs.append(subprocess.Popen([PY, PORT, "words", a16, os.path.join(D, "words.json")], **quiet))
else:
    open(os.path.join(D, "words.json"), "w").write('{"transcription": []}')
while pm.poll() is None:
    print(f"progress mattes {len(os.listdir(os.path.join(D, 'mattes')))} {len(times)}", flush=True)
    time.sleep(2)
for j in jobs:
    j.wait()
if pm.returncode:
    sys.exit("error prep: the person matte failed (is PyTorch installed? see AGENT_SETUP.md)")
if not os.path.exists(os.path.join(D, "words.json")):
    open(os.path.join(D, "words.json"), "w").write('{"transcription": []}')
print(f"prep done {ID}", flush=True)
