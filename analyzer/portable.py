"""portable.py: the analyzer's Apple-only tools, rebuilt with free cross-platform libraries (Windows, Linux, or a Mac in portable mode).
Each command writes EXACTLY the format of the Swift tool it replaces, so analyze.py and style_deep.py do not change.

  python portable.py textboxes VIDEO FPS OUT.jsonl     on-screen text (EasyOCR)                     = analyzer/textboxes.swift
  python portable.py visiontags IMG...                 faces with eye line (OpenCV YuNet); no labels = analyzer/visiontags.swift
  python portable.py rects IMG...                      rectangles: cards, screenshots (OpenCV)     = analyzer/rects.swift
  python portable.py personmatte VIDEO OUTDIR TIMES    person matte (Robust Video Matting)         = analyzer/personmatte.swift
  python portable.py words AUDIO16.wav OUT.json        word timings (faster-whisper)               = whisper-cli -ml 1 -oj

Portable mode is used when the computer is not a Mac, or when SM_PORTABLE=1 (to test the Windows path on a Mac).
"""
import json, math, os, subprocess, sys

# downloads (EasyOCR's models, the face model, Robust Video Matting, the speech model) verify certificates with certifi's bundle:
# the python.org Python on a Mac and some Windows setups have no usable default bundle (CERTIFICATE_VERIFY_FAILED)
try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where()); os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "models")
YUNET = os.path.join(MODELS, "face_detection_yunet_2023mar.onnx")
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"


def is_portable():
    return os.environ.get("SM_PORTABLE") == "1" or sys.platform != "darwin"


def frames_at(video, times, w=None, h=None):
    """Yield (t, BGR frame) for each time, read in one ffmpeg pass (the frames nearest to each time)."""
    import numpy as np
    pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
                         "-of", "json", video], capture_output=True, text=True)
    st = json.loads(pr.stdout)["streams"][0]
    W0, H0 = st["width"], st["height"]
    if w is None:
        w, h = W0, H0
    num, den = (st.get("r_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den or 1) or 30.0
    want = sorted(times)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                          stdout=subprocess.PIPE)
    i, k, size = 0, 0, w * h * 3
    while k < len(want):
        buf = ff.stdout.read(size)
        if len(buf) < size:
            break
        t = i / fps
        while k < len(want) and want[k] < t + 0.5 / fps:
            yield want[k], np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            k += 1
        i += 1
    ff.stdout.close(); ff.wait()


def duration(video):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


# ---------------------------------------------------------------- on-screen text
def textboxes(video, fps, out):
    import easyocr
    reader = easyocr.Reader(["en"], gpu=_cuda(), verbose=False)
    d = duration(video); step = 1.0 / float(fps)
    times = [round(j * step, 4) for j in range(int(d / step) + 1) if j * step < d]
    W, H = 540, 960
    with open(out, "w") as fh:
        for t, img in frames_at(video, times, W, H):
            boxes = []
            for pts, text, conf in reader.readtext(img, paragraph=False):
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                x0, x1, y0, y1 = max(0, min(xs)), min(W, max(xs)), max(0, min(ys)), min(H, max(ys))
                boxes.append({"x": x0 / W, "y": y0 / H, "w": (x1 - x0) / W, "h": (y1 - y0) / H, "text": str(text), "conf": float(conf)})
            fh.write(json.dumps({"t": t, "boxes": boxes}) + "\n")


# ---------------------------------------------------------------- faces (and the empty label list)
def _yunet():
    import cv2
    if not os.path.exists(YUNET):
        os.makedirs(MODELS, exist_ok=True)
        import urllib.request
        urllib.request.urlretrieve(YUNET_URL, YUNET)
    return cv2.FaceDetectorYN.create(YUNET, "", (320, 320), 0.6, 0.3, 50)


def visiontags(paths):
    import cv2
    det = _yunet()
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            continue
        h, w = img.shape[:2]
        det.setInputSize((w, h))
        _, faces = det.detect(img)
        out = []
        for f in (faces if faces is not None else []):
            x, y, fw, fh = [float(v) for v in f[:4]]
            rex, rey, lex, ley, nx, ny = [float(v) for v in f[4:10]]
            eye_y = (rey + ley) / 2
            roll = math.atan2(ley - rey, lex - rex)
            mid = (rex + lex) / 2; span = max(1.0, abs(lex - rex))
            yaw = max(-1.2, min(1.2, (nx - mid) / span * 1.5))
            # YuNet's box -> the shape of Apple Vision's face box (measured on 31 frames of 9 videos: YuNet is 1.12x as tall, 0.855x as
            # wide, its top 0.112 of a Vision box height higher; the eye line is the same), so the shot sizes of style_deep.py stay right
            vh, vw = fh / 1.12, fw / 0.855
            vx, vy = x + fw / 2 - vw / 2, y + 0.112 * vh
            out.append({"x": max(0.0, vx / w), "y": max(0.0, vy / h), "w": vw / w, "h": vh / h, "eye_y": eye_y / h, "roll": roll, "yaw": yaw})
        # Apple's image labels have no free equivalent here: B-roll kinds then come from flatness + faces (style_deep.py)
        labels = [["people", 0.9]] if out else []
        print(json.dumps({"file": os.path.basename(p), "labels": labels, "faces": out, "salient": []}), flush=True)


# ---------------------------------------------------------------- rectangles
def rects(paths):
    """Upright rectangles: Canny edges on the grey picture AND on three color channels (a card often differs from the room in color
    more than in brightness), 5 edge thresholds; a contour counts when it is upright (within 6 degrees) and fills >= 70 % of its box.
    boxes too: analyze.py's card filters (found again, arrives at once, not like the room) remove them."""
    import cv2, numpy as np
    k3 = np.ones((3, 3), np.uint8)
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            print(json.dumps({"file": os.path.basename(p), "rects": []})); continue
        h, w = img.shape[:2]; mind = min(w, h)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB); hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        srcs = [cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), lab[..., 1], lab[..., 2], hsv[..., 1]]
        found = []
        for s0 in srcs:
            s1 = cv2.GaussianBlur(s0, (5, 5), 0)
            for lo, hi in ((10, 40), (20, 60), (30, 90), (60, 160), (100, 220)):
                cs, _ = cv2.findContours(cv2.dilate(cv2.Canny(s1, lo, hi), k3), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
                for c in cs:
                    x, y, bw, bh = cv2.boundingRect(c)
                    if bw < 0.08 * mind or bh < 0.08 * mind or bw * bh > 0.95 * w * h or min(bw, bh) / max(bw, bh) < 0.15:
                        continue
                    ang = abs(cv2.minAreaRect(c)[2]) % 90
                    if min(ang, 90 - ang) > 6:
                        continue
                    a = cv2.approxPolyDP(c, 0.04 * cv2.arcLength(c, True), True)
                    fill = cv2.contourArea(cv2.convexHull(c)) / float(bw * bh)
                    if (len(a) == 4 or fill > 0.85) and fill >= 0.7:
                        found.append([x / w, y / h, (x + bw) / w, (y + bh) / h, round(min(1.0, fill), 2)])
        keep = []   # one box for each card (the passes find the same card many times)
        for r in sorted(found, key=lambda r: -(r[2] - r[0]) * (r[3] - r[1])):
            if all(_iou(r, k) < 0.7 for k in keep):
                keep.append(r)
        print(json.dumps({"file": os.path.basename(p), "rects": [[round(v, 3) for v in r[:4]] + [r[4]] for r in keep[:12]]}), flush=True)


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / max(1e-9, u)


# ---------------------------------------------------------------- person matte
def _cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def personmatte(video, outdir, times_file):
    import numpy as np, torch
    from PIL import Image
    if sys.platform == "darwin" and os.path.exists("/etc/ssl/cert.pem"):
        os.environ.setdefault("SSL_CERT_FILE", "/etc/ssl/cert.pem")
    dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
    # resnet50 on a graphics chip; the faster mobilenetv3 on a plain processor
    model = torch.hub.load("PeterL1n/RobustVideoMatting", "resnet50" if dev != "cpu" else "mobilenetv3", trust_repo=True,
                           skip_validation=True).eval().to(dev)
    times = [float(x) for x in open(times_file).read().split()]
    W, H, FPS = 540, 960, 30.0
    want = {}
    for j, t in enumerate(times):
        want.setdefault(int(round(t * FPS - 0.5)), j)
    os.makedirs(outdir, exist_ok=True)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          stdout=subprocess.PIPE)
    rec, prev, i, done = [None] * 4, None, 0, 0
    with torch.no_grad():
        while True:
            buf = ff.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break
            f = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
            small = f[::10, ::10].mean(axis=2)
            if prev is not None and np.abs(small - prev).mean() > 28:   # a hard cut: forget the last shot
                rec = [None] * 4
            prev = small
            src = torch.from_numpy(f).to(dev).permute(2, 0, 1).float().div(255).unsqueeze(0)
            _, pha, *rec = model(src, *rec, downsample_ratio=0.5)
            if i in want:
                a = (pha[0, 0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
                Image.fromarray(a).save(os.path.join(outdir, f"matte_{want[i]:05d}.png")); done += 1
            i += 1
    ff.stdout.close(); ff.wait()
    print(f"wrote {done} of {len(times)} mattes", flush=True)


# ---------------------------------------------------------------- word timings
def words(audio, out, model_name=None):
    from faster_whisper import WhisperModel
    name = model_name or os.environ.get("SM_WHISPER", "base.en")
    m = WhisperModel(name, device="cuda" if _cuda() else "cpu", compute_type="int8")
    # the 16 kHz mono WAV is read here (Python's wave module), not by faster-whisper's PyAV reader (it breaks with newer PyAV)
    import wave, numpy as np
    with wave.open(audio, "rb") as wf:
        raw = wf.readframes(wf.getnframes()); ch = wf.getnchannels(); sw = wf.getsampwidth()
    a = np.frombuffer(raw, {2: np.int16, 4: np.int32}[sw]).astype(np.float32) / (32768.0 if sw == 2 else 2147483648.0)
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    segs, info = m.transcribe(a, word_timestamps=True, vad_filter=False, language="en" if name.endswith(".en") else None)
    tr = []
    for s in segs:
        for wd in s.words or []:
            tr.append({"offsets": {"from": int(wd.start * 1000), "to": int(wd.end * 1000)}, "text": wd.word})
    json.dump({"result": {"language": info.language}, "transcription": tr}, open(out, "w"))


def warmup(mode="all"):
    """Download every model now (setup), so a download problem shows during the setup and not on the first video.
    mode "mac": only the models of the Mac version (the speech model + Robust Video Matting if PyTorch is installed);
    Apple Vision does the text, the faces and the person cut-out there."""
    if mode == "mac":
        name = os.environ.get("SM_WHISPER", "base.en")
        print(f"models: the speech model (faster-whisper {name})", flush=True)
        from faster_whisper import WhisperModel; WhisperModel(name, device="cpu", compute_type="int8")
        try:
            import torch
        except ImportError:
            print("models: no PyTorch (lite setup): Apple Vision makes the person cut-out", flush=True); return
        print("models: the person cut-out (Robust Video Matting)", flush=True)
        torch.hub.load("PeterL1n/RobustVideoMatting", "resnet50", trust_repo=True, skip_validation=True)
        print("models: all downloaded", flush=True); return
    import torch
    print("models: EasyOCR (English)", flush=True); import easyocr; easyocr.Reader(["en"], gpu=False, verbose=False)
    print("models: the face detector (OpenCV YuNet)", flush=True); _yunet()
    name = os.environ.get("SM_WHISPER", "base.en")
    print(f"models: the speech model (faster-whisper {name})", flush=True)
    from faster_whisper import WhisperModel; WhisperModel(name, device="cpu", compute_type="int8")
    print("models: the person cut-out (Robust Video Matting)", flush=True)
    for arch in ("mobilenetv3", "resnet50"):
        torch.hub.load("PeterL1n/RobustVideoMatting", arch, trust_repo=True, skip_validation=True)
    print("models: all downloaded", flush=True)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "warmup": warmup(*args[:1]); sys.exit(0)
    if cmd == "textboxes": textboxes(*args[:3])
    elif cmd == "visiontags": visiontags(args)
    elif cmd == "rects": rects(args)
    elif cmd == "personmatte": personmatte(*args[:3])
    elif cmd == "words": words(*args[:2])
    else: sys.exit("unknown command " + cmd)
