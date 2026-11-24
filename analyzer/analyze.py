"""analyze.py ID: cuts, layout, B-roll, captions, palette, the packed video and analysis.json (run with the .venv python).
Reads data/ID/{w.mp4, mattes/, text.jsonl, words.json} (from prep.sh) and writes:
  data/ID/packed.mp4   3 x 2 grid of 540x960 cells, one video so every layer stays in sync:
                       [0 source | 1 character matte | 2 text matte]
                       [3 b-roll region | 4 motion | 5 edges]
  data/ID/analysis.json  shots, layout timeline, captions, palette, stats
  data/ID/barcode.png, data/ID/keys/shot_NNN.jpg
"""
import json, os, subprocess, sys
import cv2
import numpy as np
from PIL import Image

SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository folder (works wherever it is unzipped)
ID = sys.argv[1]
D = f"{SM}/data/{ID}"
W, H, FPS = 540, 960, 30
os.makedirs(f"{D}/keys", exist_ok=True)


def log(*a):
    print(*a, flush=True)


# ---------- inputs ----------
cap = cv2.VideoCapture(f"{D}/w.mp4")
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(f)
N = len(frames)
log(f"step frames {N}")

matte_files = sorted(x for x in os.listdir(f"{D}/mattes") if x.endswith(".png"))
def matte(i):
    if not matte_files:
        return np.zeros((H, W), np.uint8)
    # mattes may be sampled at a lower rate than the frames (prep.sh: 15 fps)
    j = min(int(i * len(matte_files) / max(1, N)), len(matte_files) - 1)
    m = cv2.imread(f"{D}/mattes/{matte_files[j]}", cv2.IMREAD_GRAYSCALE)
    if m.shape != (H, W):
        m = cv2.resize(m, (W, H))
    return m

text_samples = []
if os.path.exists(f"{D}/text.jsonl"):
    for line in open(f"{D}/text.jsonl"):
        line = line.strip()
        if line:
            text_samples.append(json.loads(line))
words = []
if os.path.exists(f"{D}/words.json"):
    wj = json.load(open(f"{D}/words.json"))
    for s in wj.get("transcription", []):
        t = s["text"].strip()
        if not t or t.startswith("["):
            continue
        words.append({"t0": s["offsets"]["from"] / 1000, "t1": s["offsets"]["to"] / 1000, "w": t})

# ---------- per-frame features ----------
def hist(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [12, 4, 4], [0, 180, 0, 256, 0, 256])
    return cv2.normalize(h, h).flatten()

regions = {"top": (0, H // 2), "bottom": (H // 2, H), "full": (0, H)}
dist = {k: np.zeros(N) for k in regions}
seam = np.zeros(N)
prev = None
for i, f in enumerate(frames):
    hs = {k: hist(f[a:b]) for k, (a, b) in regions.items()}
    if prev is not None:
        for k in regions:
            dist[k][i] = cv2.compareHist(prev[k], hs[k], cv2.HISTCMP_BHATTACHARYYA)
    prev = hs
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
    rd = np.abs(np.diff(g, axis=0)).mean(axis=1)  # 959 row differences
    band = rd[H
    seam[i] = band.max() / (np.median(rd) + 1.0)
log("step features")


def peaks(d, thr):
    out = []
    for i in range(1, N):
        if d[i] > thr and d[i] == d[max(0, i - 4): i + 5].max():
            if not out or i - out[-1] > 4:
                out.append(i)
    return out

cuts_top = peaks(dist["top"], 0.38)
cuts_bot = peaks(dist["bottom"], 0.38)
cuts_full = peaks(dist["full"], 0.33)
all_cuts = sorted(set(cuts_top) | set(cuts_bot) | set(cuts_full))
merged = []
for c in all_cuts:
    if not merged or c - merged[-1] > 4:
        merged.append(c)
bounds = [0] + merged + [N]
log(f"step cuts {len(merged)}")

# ---------- layout per frame ----------
cov = np.zeros(N)       # person coverage of the full frame
cov_bot = np.zeros(N)   # person coverage of the bottom half
cross = np.zeros(N)     # share of the width where the person is on both sides of the middle line
mattes = []
for i in range(N):
    m = matte(i)
    mattes.append(m)
    cov[i] = (m > 128).mean()
    cov_bot[i] = (m[H // 2:] > 128).mean()
    # the person crosses the middle line (in a split, the seam cuts the picture there): a full-frame speaker
    cross[i] = ((m[H // 2 - 14] > 128) & (m[H // 2 + 14] > 128)).mean()

split_raw = (seam > 3.2).astype(np.float32)
# a split frame = a hard seam at 50 %; smooth inside each shot
layout = ["a_full"] * N
for s, e in zip(bounds[:-1], bounds[1:]):
    # captions sit on the middle line and read as a seam: a shot where the person
    # crosses the middle line is not a split
    sp = split_raw[s:e].mean() > 0.5 and np.median(cross[s:e]) < 0.12
    c = cov[s:e].mean()
    # a person in most frames of the shot = A-roll, even when small in a wide shot
    present = (cov[s:e] > 0.012).mean()
    if sp:
        lay = "split"
    elif c > 0.07 or present > 0.6:
        lay = "a_full"
    else:
        lay = "b_full"
    for i in range(s, e):
        layout[i] = lay
log("step layout")

SW, SH = 90, 160
inserts, ins_rect = [], {}
af = [i for i in range(N) if layout[i] == "a_full"]
if len(af) > 30:
    k5 = np.ones((5, 5), np.uint8)
    sm = {i: cv2.resize(frames[i], (SW, SH), interpolation=cv2.INTER_AREA).astype(np.float32) for i in af}
    pm = {i: cv2.resize(mattes[i], (SW, SH), interpolation=cv2.INTER_AREA) for i in af}
    samp = af[::3]
    stk = np.stack([sm[i] for i in samp])
    hide = np.stack([cv2.dilate((pm[i] > 40).astype(np.uint8), k5) for i in samp]).astype(bool)
    stk[hide] = np.nan
    with np.errstate(all="ignore"):
        plate = np.nanmedian(stk, axis=0)
    valid0 = ~np.isnan(plate[..., 0])
    plate = np.nan_to_num(plate)
    typ = np.median(np.stack([(pm[i] > 128) for i in samp]).astype(np.float32), axis=0) > 0.5
    def pbox(m):
        ys, xs = np.where(m)
        return (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) > 20 else None
    tb = pbox(typ)
    frac, rects = {}, {}
    for i in af:
        valid = valid0 & ~cv2.dilate((pm[i] > 40).astype(np.uint8), k5).astype(bool)
        d = np.abs(sm[i] - plate).mean(axis=2)
        m = (d > 38) & valid
        frac[i] = float(m[valid].mean()) if valid.sum() > 200 else 0.0
        mm = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, k5)
        n, lab, st, _ = cv2.connectedComponentsWithStats(mm)
        if n > 1:
            j = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
            x, y, w, h = st[j][:4]
            rects[i] = (x, y, x + w, y + h)
    room = sum(1 for i in af if frac[i] < 0.12) / len(af)
    def same_person(i):
        b = pbox(pm[i] > 128)
        if b is None or tb is None:
            return False
        ix = max(0, min(b[2], tb[2]) - max(b[0], tb[0])); iy = max(0, min(b[3], tb[3]) - max(b[1], tb[1]))
        u = (b[2] - b[0]) * (b[3] - b[1]) + (tb[2] - tb[0]) * (tb[3] - tb[1]) - ix * iy
        return ix * iy / max(1, u) > 0.5
    if room >= 0.35 and tb is not None:
        flag = [i for i in af if frac[i] > 0.2 and i in rects and same_person(i)]
        groups = []
        for i in flag:
            if groups and i - groups[-1][-1] <= 3 and layout[i] == layout[groups[-1][-1]]:
                groups[-1].append(i)
            else:
                groups.append([i])
        for g in groups:
            if len(g) < 8:
                continue
            R = np.median(np.array([rects[i] for i in g], np.float32), axis=0)
            x0, y0, x1, y1 = R[0] / SW, R[1] / SH, (R[2] + 1) / SW, (R[3] + 1) / SH
            mid = g[len(g) // 2]
            sl = (slice(int(R[1]), int(R[3]) + 1), slice(int(R[0]), int(R[2]) + 1))
            tin, pin = typ[sl], (pm[mid] > 128)[sl]
            front = tin.sum() > 30 and (pin & tin).sum() / tin.sum() < 0.4
            kind = "front" if front else ("background" if (x1 - x0) * (y1 - y0) > 0.6 else "behind")
            inserts.append({"f0": g[0], "f1": g[-1] + 1, "t0": round(g[0] / FPS, 3), "t1": round((g[-1] + 1) / FPS, 3),
                            "rect": [round(float(v), 3) for v in (x0, y0, x1, y1)], "kind": kind})
            for i in range(g[0], g[-1] + 1):
                ins_rect[i] = ((x0, y0, x1, y1), kind)

# ---------- B-roll CARDS laid over the footage: pictures in front of / beside the speaker that stay on screen most of the time, so there is no empty room
# to compare with. A card = a cut INSIDE a rectangle (that area changes at once, the rest of the frame does not) + sharp straight
# borders; its border lines are then followed frame by frame to find how long it stays.
GW, GH = 180, 320
gs = [cv2.cvtColor(cv2.resize(f, (GW, GH), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY) for f in frames]
cutset = set(merged)
def grad(g):
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    return np.abs(gx), np.abs(gy)
# 1. Apple Vision's rectangle detector (analyzer/rects) on every 3rd frame; 2. each found card is followed forward and backward while
#    the picture inside its box stays the same (fills the frames Vision misses, gives the exact start and end); 3. boxes on the face go.
import tempfile
_AN = os.path.dirname(os.path.abspath(__file__))
# not a Mac (or SM_PORTABLE=1): OpenCV's rectangles (analyzer/portable.py) instead of Apple Vision's (analyzer/rects)
RECTS = [sys.executable, os.path.join(_AN, "portable.py"), "rects"] if (os.environ.get("SM_PORTABLE") == "1" or sys.platform != "darwin") else [os.path.join(_AN, "rects")]
STEP = 3
tmpd = tempfile.mkdtemp(prefix="sm_rects_")
paths = []
for i in range(0, N, STEP):
    pth = f"{tmpd}/r_{i:05d}.jpg"; cv2.imwrite(pth, cv2.resize(frames[i], (270, 480)), [cv2.IMWRITE_JPEG_QUALITY, 88]); paths.append(pth)
found = {}
for k in range(0, len(paths), 200):
    out = subprocess.run([*RECTS, *paths[k:k + 200]], capture_output=True, text=True).stdout
    for line in out.splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        found[int(r["file"][2:7])] = [q[:4] for q in r["rects"]]
for pth in paths:
    try: os.remove(pth)
    except OSError: pass
try: os.rmdir(tmpd)
except OSError: pass
room_ins = list(inserts)                              # what the room method found
typ_all = np.median(np.stack([cv2.resize(mattes[i], (GW, GH)) > 128 for i in range(0, N, max(1, N // 60))]).astype(np.float32), axis=0) > 0.5
ys_ = np.where(typ_all.any(axis=1))[0]
hy = ys_.min() / GH if len(ys_) else 0.2               # the top of the head
xs_ = np.where(typ_all[int(hy * GH):int(min(1, hy + 0.2) * GH)].any(axis=0))[0]
face = (xs_.min() / GW, hy, xs_.max() / GW, hy + 0.2) if len(xs_) else None
def on_face(r):
    if face is None: return False
    cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
    return face[0] - 0.03 < cx < face[2] + 0.03 and face[1] - 0.02 < cy < face[1] + 0.3   # the head + face zone
def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / max(1e-9, u)
def reg(i, r):
    return gs[i][int(r[1] * GH):int(r[3] * GH), int(r[0] * GW):int(r[2] * GW)].astype(np.float32)
pres = {}                                             # frame -> list of card boxes
seeds = []
# the room at each spot: the median of the speaker frames (a card that looks like the room there = a shelf, a frame, a window)
afr = [i for i in range(N) if layout[i] == "a_full"]
room_med = np.median(np.stack([gs[i] for i in afr[::max(1, len(afr) // 60)]]).astype(np.float32), axis=0) if afr else None
for f0, rs in found.items():
    if layout[f0] != "a_full":
        continue                                      # cards only in full-frame speaker shots (in a split the top half is already B-roll)
    for r in rs:
        if (r[2] - r[0]) * (r[3] - r[1]) < 0.02 or (r[2] - r[0]) * (r[3] - r[1]) > 0.8 or on_face(r):   # a card is >= 3.5 % of the frame
            continue
        seeds.append((f0, r))
spans = []
for f0, r in seeds:
    if any(a <= f0 < b and iou(r, q) > 0.6 for a, b, q in spans):
        continue                                      # already inside a followed span
    ref = reg(f0, r)
    if ref.size < 50:
        continue
    same = lambda i: np.abs(reg(i, r) - ref).mean() < 10
    a = f0
    while a - 1 >= 0 and layout[a - 1] == "a_full" and same(a - 1): a -= 1
    b = f0
    while b + 1 < N and layout[b + 1] == "a_full" and same(b + 1): b += 1
    spans.append((a, b + 1, r))
# a card must stay at least 0.3 s, and its box must not be the whole speaker shot's background (a real object in the room)
cards = []
for a, b, r in spans:
    if b - a < 15:
        continue                                      # under 0.5 s: a hand, a pen, a flicker
    if r[3] > 0.97 and b - a < 45:
        continue                                      # a short box on the bottom edge = her hands / the desk
    # Vision must find this box again in >= 20 % of the samples while it is on screen (a fluke box - the wall, the face - is not)
    smp = [k for k in found if a <= k < b]
    hits = sum(1 for k in smp if any(iou(r, q) > 0.6 for q in found[k]))
    if hits < max(2, 0.2 * len(smp)):
        continue
    # a card arrives or leaves AT ONCE: the inside of its box jumps while the rest of the frame stays (a monitor, a lamp, a
    # shelf only drifts, or changes with the whole frame at a camera cut)
    def jump(k):
        if k <= 0 or k >= N:
            return True                               # the video's first / last frame
        ins_ = np.abs(reg(k, r) - reg(k - 1, r)).mean()
        whole = np.abs(gs[k].astype(np.float32) - gs[k - 1].astype(np.float32))
        msk = np.ones_like(whole, bool); msk[int(r[1] * GH):int(r[3] * GH), int(r[0] * GW):int(r[2] * GW)] = False
        return ins_ > 18 and ins_ > 2.5 * whole[msk].mean()
    if not (jump(a) or jump(b)):
        continue
    if room_med is not None:
        rm = room_med[int(r[1] * GH):int(r[3] * GH), int(r[0] * GW):int(r[2] * GW)]
        if rm.size and np.abs(reg((a + b) // 2, r) - rm).mean() < 14:
            continue                                  # it looks like the room there: part of the set, not B-roll
    if b - a > 0.85 * sum(1 for l in layout if l != "b_full"):
        continue                                      # on screen the whole video = part of the room (a shelf, a frame), not B-roll
    cards.append({"f0": a, "f1": b, "R": (r[0] * GW, r[1] * GH, r[2] * GW - 1, r[3] * GH - 1)})
# one card found twice (a box inside a box, at the same time): keep the bigger box
def inside(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return ix * iy / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))
cards.sort(key=lambda c: -(c["R"][2] - c["R"][0]) * (c["R"][3] - c["R"][1]))
keep = []
for c in cards:
    if any(inside(c["R"], k["R"]) > 0.7 and min(c["f1"], k["f1"]) - max(c["f0"], k["f0"]) > 0.5 * (c["f1"] - c["f0"]) for k in keep):
        continue
    keep.append(c)
cards = keep
# cards shown together side by side (same height, overlapping in time) = one B-roll moment
cards.sort(key=lambda c: c["f0"])
moments = []
for c in cards:
    for mo in moments:
        ov = min(mo["f1"], c["f1"]) - max(mo["f0"], c["f0"])
        r0 = mo["rects"][0]
        same_row = abs(r0[1] - c["R"][1]) < 0.06 * GH and abs(r0[3] - c["R"][3]) < 0.06 * GH
        if same_row and ov > 0.6 * min(mo["f1"] - mo["f0"], c["f1"] - c["f0"]) and len(mo["rects"]) < 4:
            mo["rects"].append(c["R"]); mo["f0"] = min(mo["f0"], c["f0"]); mo["f1"] = max(mo["f1"], c["f1"]); break
    else:
        moments.append({"f0": c["f0"], "f1": c["f1"], "rects": [c["R"]]})
for mo in moments:
    rs = mo["rects"]
    U = tuple(int(round(v)) for v in (min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)))
    x0, y0, x1, y1 = U[0] / GW, U[1] / GH, (U[2] + 1) / GW, (U[3] + 1) / GH
    if (x1 - x0) * (y1 - y0) > 0.85:
        continue                                      # the whole frame = a cut, not a card
    mid = (mo["f0"] + mo["f1"]) // 2
    pm_ = cv2.resize(mattes[mid], (GW, GH)) > 128
    sl = (slice(U[1], U[3] + 1), slice(U[0], U[2] + 1))
    tin, pin = typ_all[sl], pm_[sl]
    # the person cut-out counts a card over her body as part of her, so it cannot tell front from behind: a card that sits mostly
    # on her body is in front (a card behind her would be hidden); one that only touches her edge is behind; none = beside
    body = tin.mean() if tin.size else 0
    if body > 0.4:
        kind = "front"
    elif body > 0.05:
        kind = "behind"
    else:
        kind = "beside"
    face_bot = hy + 0.22                              # about the chin, from the top of the head
    vert = "below the face" if y0 > face_bot - 0.02 else ("above the head" if y1 < hy + 0.04 else "at face height")
    n = len(rs)
    what = f"{'two pictures side by side' if n == 2 else f'{n} pictures' if n > 2 else 'a picture'}"
    where = f"{what} {'in front of' if kind == 'front' else 'behind' if kind == 'behind' else 'beside'} the speaker, {vert}"
    ins = {"f0": mo["f0"], "f1": mo["f1"], "t0": round(mo["f0"] / FPS, 3), "t1": round(mo["f1"] / FPS, 3),
           "rect": [round(float(v), 3) for v in (x0, y0, x1, y1)], "kind": kind, "where": where, "count": n,
           "rects": [[round(float(r[0]) / GW, 3), round(float(r[1]) / GH, 3), round((float(r[2]) + 1) / GW, 3), round((float(r[3]) + 1) / GH, 3)] for r in rs]}
    # the room method may have found the same moment: keep one
    if any(min(ins["f1"], o["f1"]) - max(ins["f0"], o["f0"]) > 0.5 * (ins["f1"] - ins["f0"]) for o in room_ins):
        continue
    inserts.append(ins)
    for i in range(ins["f0"], ins["f1"]):
        ins_rect.setdefault(i, ((x0, y0, x1, y1), kind))
inserts.sort(key=lambda x: x["f0"])
log(f"step inserts {len(inserts)} ({len(moments)} card moments)")

# ---------- captions (on-screen text that is a caption or a title, not UI text) ----------
# text that stays on screen for a long time is part of the scene (a logo on a hoodie, a UI label), not a caption
from collections import Counter
presence = Counter()
for smp in text_samples:
    for t in {b["text"].strip().upper() for b in smp["boxes"]}:
        presence[t] += 1
scene_text = {t for t, c in presence.items() if len(text_samples) and c / len(text_samples) > 0.2}
import re
def spoken_near(t):
    return {re.sub(r"[^a-z0-9']", "", w["w"].lower()) for w in words if t - 1.5 <= w["t0"] <= t + 1.0}

captions_by_sample = []
for smp in text_samples:
    keep = []
    for b in smp["boxes"]:
        cy = b["y"] + b["h"] / 2
        big = b["h"] >= 0.038
        txt = b["text"].strip()
        if txt.upper() in scene_text or sum(ch.isalnum() for ch in txt) < 2:
            continue
        # a caption = on-screen text that repeats the words spoken at that moment
        toks = [re.sub(r"[^a-z0-9']", "", w.lower()) for w in txt.split()]
        toks = [w for w in toks if len(w) >= 2]
        near = spoken_near(smp["t"])
        said = bool(toks) and sum(w in near for w in toks) / len(toks) >= 0.5
        b["kind"] = "caption" if said else "title"
        if (said or big) and b["conf"] >= 0.5:
            keep.append(b)
    captions_by_sample.append((smp["t"], keep))

def caption_boxes(i):
    if not captions_by_sample:
        return []
    t = i / FPS
    j = min(range(len(captions_by_sample)), key=lambda k: abs(captions_by_sample[k][0] - t))
    if abs(captions_by_sample[j][0] - t) > 0.15:
        return []
    return captions_by_sample[j][1]

# caption events (merge equal text in a row)
cap_events = []
for t, boxes in captions_by_sample:
    for b in boxes:
        txt = b["text"].strip()
        if cap_events and cap_events[-1]["text"] == txt and t - cap_events[-1]["t1"] <= 0.25:
            cap_events[-1]["t1"] = t
        else:
            cap_events.append({"t0": t, "t1": t, "text": txt, "kind": b["kind"], "box": [b["x"], b["y"], b["w"], b["h"]]})
cap_events = [c for c in cap_events if c["t1"] - c["t0"] >= 0.09 or True]
log(f"step captions {len(cap_events)}")

# ---------- packed video ----------
PW, PH = W * 3, H * 2
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{PW}x{PH}",
                       "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "15", "-preset", "medium",
                       "-pix_fmt", "yuv420p", "-movflags", "+faststart", f"{D}/packed_noaudio.mp4"],
                      stdin=subprocess.PIPE)
prev_small = None
motion_mean = np.zeros(N)
bar = np.zeros((1, N, 3), np.uint8)
for i, f in enumerate(frames):
    lay = layout[i]
    m = mattes[i]
    # regions
    aroll = np.zeros((H, W), np.uint8)
    broll = np.zeros((H, W), np.uint8)
    if lay == "split":
        aroll[H // 2:] = 255
        broll[:H // 2] = 255
    elif lay == "a_full":
        aroll[:] = 255
    else:
        broll[:] = 255
    if i in ins_rect:   # a picture inside the speaker shot: the B-roll cell holds it (behind the speaker: minus the person)
        (x0, y0, x1, y1), kd = ins_rect[i]
        broll[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = 255
        if kd != "front":
            broll = cv2.min(broll, 255 - m)
    character = cv2.min(m, aroll)
    # text matte: glyph pixels inside caption boxes
    tm = np.zeros((H, W), np.uint8)
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    for b in caption_boxes(i):
        x0 = int(max(0, (b["x"] - b["h"] * 0.25) * W)); x1 = int(min(W, (b["x"] + b["w"] + b["h"] * 0.25) * W))
        y0 = int(max(0, (b["y"] - b["h"] * 0.3) * H)); y1 = int(min(H, (b["y"] + b["h"] * 1.3) * H))
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        roi = g[y0:y1, x0:x1].astype(np.int16)
        med = np.median(roi)
        if med < 128:
            glyph = ((roi > med + 60) & (roi > 150)).astype(np.uint8) * 255
        else:
            glyph = ((roi < med - 60) & (roi < 110)).astype(np.uint8) * 255
        glyph = cv2.dilate(glyph, np.ones((2, 2), np.uint8))
        tm[y0:y1, x0:x1] = np.maximum(tm[y0:y1, x0:x1], glyph)
    # motion (optical flow magnitude)
    small = cv2.resize(g, (W // 2, H // 2))
    if prev_small is None or (i in merged):
        mag = np.zeros_like(small, np.float32)
    else:
        flow = cv2.calcOpticalFlowFarneback(prev_small, small, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mag = np.linalg.norm(flow, axis=2)
    prev_small = small
    motion_mean[i] = float(mag.mean())
    mot = np.clip(mag / 6.0, 0, 1) ** 0.6
    mot = cv2.resize((mot * 255).astype(np.uint8), (W, H))
    mot = cv2.GaussianBlur(mot, (0, 0), 3)
    # edges
    e = cv2.Canny(cv2.GaussianBlur(g, (0, 0), 1.2), 50, 130)
    e = cv2.dilate(e, np.ones((2, 2), np.uint8))
    def c3(x):
        return cv2.merge([x, x, x])
    top = np.hstack([f, c3(character), c3(tm)])
    bot = np.hstack([c3(broll), c3(mot), c3(e)])
    ff.stdin.write(np.vstack([top, bot]).tobytes())
    bar[0, i] = f.reshape(-1, 3).mean(axis=0)
    if i % 300 == 0:
        log(f"step pack {i}/{N}")
ff.stdin.close(); ff.wait()
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{D}/packed_noaudio.mp4", "-i", f"{D}/audio.m4a",
                "-c:v", "copy", "-c:a", "copy", "-shortest", f"{D}/packed.mp4"], check=True)
os.remove(f"{D}/packed_noaudio.mp4")
cv2.imwrite(f"{D}/barcode.png", cv2.resize(bar, (N, 8), interpolation=cv2.INTER_NEAREST))
log("step packed")

# ---------- shots ----------
def palette(img_bgr, k=5):
    im = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)).resize((160, 284))
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: k * 3]
    counts = sorted(q.getcolors(), reverse=True)
    out = []
    for cnt, idx in counts:
        r, gg, b = pal[idx * 3: idx * 3 + 3]
        out.append({"hex": f"#{r:02x}{gg:02x}{b:02x}", "share": round(cnt / (160 * 284), 3)})
    return out

shots = []
for n, (s, e) in enumerate(zip(bounds[:-1], bounds[1:])):
    mid = (s + e) // 2
    f = frames[mid]
    cv2.imwrite(f"{D}/keys/shot_{n:03d}.jpg", cv2.resize(f, (270, 480)), [cv2.IMWRITE_JPEG_QUALITY, 82])
    lay = layout[mid]
    m = mattes[mid]
    ys, xs = np.where(m > 128)
    framing = None
    if len(ys) > 50 and lay != "b_full":
        top_y = ys.min() / H
        area_h = 0.5 if lay == "split" else 1.0
        rel = (ys.max() - ys.min()) / H / area_h
        framing = {"head_top": round(float(top_y), 3), "person_height": round(float(rel), 3),
                   "center_x": round(float(xs.mean() / W), 3)}
    region = f[:H // 2] if lay == "split" else f
    shots.append({"i": n, "f0": int(s), "f1": int(e), "t0": round(s / FPS, 3), "t1": round(e / FPS, 3),
                  "layout": lay, "key": f"keys/shot_{n:03d}.jpg", "framing": framing,
                  "palette": palette(f), "motion": round(float(motion_mean[s:e].mean()), 3),
                  "broll_palette": palette(region, 4) if lay != "a_full" else None})

def accent_palette(img_bgr):
    im = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    q = im.quantize(colors=16, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:48]
    tot = im.size[0] * im.size[1]
    cols = []
    for cnt, idx in q.getcolors():
        r, gg, b = pal[idx * 3: idx * 3 + 3]
        hsv = cv2.cvtColor(np.uint8([[[b, gg, r]]]), cv2.COLOR_BGR2HSV)[0, 0]
        cols.append({"hex": f"#{r:02x}{gg:02x}{b:02x}", "share": round(cnt / tot, 3), "sat": int(hsv[1]), "val": int(hsv[2])})
    base = sorted(cols, key=lambda c: -c["share"] * (1 if c["val"] < 70 else 0.2))[:2]
    acc = [c for c in cols if c not in base and c["share"] > 0.006 and c["val"] >= 70]
    acc = sorted(acc, key=lambda c: -(c["sat"] / 255 * 0.7 + c["val"] / 255 * 0.3) * (c["share"] ** 0.3))[:4]
    return base + acc

# whole-video palette from a montage of key frames
mont = np.vstack([cv2.resize(frames[(s + e) // 2], (90, 160)) for s, e in zip(bounds[:-1], bounds[1:])])
gpal = palette(mont, 8)

runs = []
for i, l in enumerate(layout):
    if runs and runs[-1]["layout"] == l:
        runs[-1]["f1"] = i + 1
    else:
        runs.append({"layout": l, "f0": i, "f1": i + 1})
for r in runs:
    r["t0"], r["t1"] = round(r["f0"] / FPS, 3), round(r["f1"] / FPS, 3)

dur = N / FPS
lay_share = {k: round(sum(1 for l in layout if l == k) / N, 3) for k in ["split", "a_full", "b_full"]}
broll_cuts = [c for c in merged if layout[c] != "a_full"]
stats = {
    "duration": round(dur, 2), "frames": N, "shots": len(shots),
    "avg_shot": round(dur / max(1, len(shots)), 2), "cuts_per_min": round(len(merged) / dur * 60, 1),
    "broll_changes": len(broll_cuts), "layout_share": lay_share,
    "captions": len(cap_events), "words": len(words),
    "words_per_sec": round(len(words) / dur, 2) if words else 0,
    "motion_mean": round(float(motion_mean.mean()), 3),
    "person_coverage": round(float(cov.mean()), 3),
}
out = {"id": ID, "fps": FPS, "w": W, "h": H, "frames": N, "duration": dur,
       "packed": "packed.mp4", "grid": {"cols": 3, "rows": 2,
       "cells": ["source", "character", "text", "broll", "motion", "edges"]},
       "barcode": "barcode.png", "cuts": merged, "cuts_top": cuts_top, "cuts_bottom": cuts_bot,
       "layout_runs": runs, "inserts": inserts, "shots": shots, "captions": cap_events, "words": words,
       "palette": gpal, "accent_palette": accent_palette(mont), "stats": stats, "scene_text": sorted(scene_text),
       "motion_curve": [round(float(x), 3) for x in motion_mean[::3]]}
json.dump(out, open(f"{D}/analysis.json", "w"), indent=1)
log("step done " + json.dumps(stats))
