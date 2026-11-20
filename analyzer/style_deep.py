"""style_deep.py ID: the 11 style components (run with the .venv python, after analyze.py).
The full style extraction. Reads data/ID/{analysis.json, w.mp4, mattes/, text.jsonl, words.json} and writes
data/ID/style.json: eleven components (layout, pace, person, broll, broll_framing, grade, subtitles, typography,
textcolor, motion, set), each with a headline, specs (label/value pairs), the data the site draws, and the
instructions for an editor. Crops go to data/ID/parts/. Everything is measured from the pixels (OpenCV + Apple Vision,
local): no paid model.
"""
import json, os, re, subprocess, sys, colorsys
from collections import Counter
import cv2
import numpy as np

SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository folder (works wherever it is unzipped)
ID = sys.argv[1]
D = f"{SM}/data/{ID}"
P = f"{D}/parts"
os.makedirs(P, exist_ok=True)
VT = f"{SM}/analyzer/visiontags"
W, H, FPS = 540, 960, 30


def log(*a):
    print(*a, flush=True)


a = json.load(open(f"{D}/analysis.json"))
N = a["frames"]
dur = a["duration"]
shots = a["shots"]
cuts = a["cuts"]
words = a["words"]
layout = ["a_full"] * N
for r in a["layout_runs"]:
    for i in range(r["f0"], min(N, r["f1"])):
        layout[i] = r["layout"]

# ---------------------------------------------------------------- frames (streamed; small copies kept)
cap = cv2.VideoCapture(f"{D}/w.mp4")
small = []          # 135 x 240 grey, every frame (flow, transitions)
luma = np.zeros(N)
full_keep = {}      # full frames we need later: shot middles + caption windows
need = set()
for s in shots:
    need.add((s["f0"] + s["f1"]) // 2)
    need.add(min(s["f1"] - 1, s["f0"] + 2))
INS = a.get("inserts", [])   # pictures inside a speaker shot (analyze.py, 2026-11-20)
for ins in INS:
    need.add((ins["f0"] + ins["f1"]) // 2)
caps_all = a["captions"]
for c in caps_all:
    f0 = int(round(c["t0"] * FPS))
    for k in range(f0 - 4, f0 + 9):
        if 0 <= k < N:
            need.add(k)
grade_samples = []
i = 0
while True:
    ok, f = cap.read()
    if not ok or i >= N:
        break
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    small.append(cv2.resize(g, (135, 240), interpolation=cv2.INTER_AREA))
    luma[i] = g.mean()
    if i in need:
        full_keep[i] = f
    if i % 6 == 0:
        grade_samples.append((i, cv2.resize(f, (135, 240), interpolation=cv2.INTER_AREA)))
    i += 1
N = min(N, len(small))
log(f"step deep frames {N}")

mfiles = sorted(x for x in os.listdir(f"{D}/mattes") if x.endswith(".png"))
def matte(i):
    if not mfiles:
        return np.zeros((H, W), np.uint8)
    j = min(int(i * len(mfiles) / max(1, N)), len(mfiles) - 1)
    m = cv2.imread(f"{D}/mattes/{mfiles[j]}", cv2.IMREAD_GRAYSCALE)
    return m if m.shape == (H, W) else cv2.resize(m, (W, H))


def hexof(bgr):
    b, g, r = [int(max(0, min(255, x))) for x in bgr]
    return f"#{r:02x}{g:02x}{b:02x}"


def cname(hx):
    """A plain colour name for a hex."""
    r, g, b = [int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l < 0.12:
        return "near-black"
    if l > 0.9 and s < 0.5:
        return "white"
    if s < 0.16:
        return "grey" if 0.3 < l < 0.75 else ("dark grey" if l <= 0.3 else "off-white")
    hue = h * 360
    names = [(15, "red"), (40, "orange"), (65, "yellow"), (160, "green"), (195, "teal"), (250, "blue"), (290, "violet"), (335, "magenta"), (360, "red")]
    n = next(nm for lim, nm in names if hue <= lim)
    if n == "orange" and l < 0.45:
        n = "brown"
    if l > 0.75:
        n = "pale " + n
    elif l < 0.3:
        n = "dark " + n
    return n


def kmeans_cols(px, k):
    px = np.float32(px)
    if len(px) < k * 10:
        return []
    if len(px) > 60000:
        px = px[np.random.default_rng(0).choice(len(px), 60000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 25, 1.0)
    _, lab, cen = cv2.kmeans(px, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    cnt = np.bincount(lab.flatten(), minlength=k)
    return [{"hex": hexof(c), "share": round(float(n) / len(px), 3)} for c, n in sorted(zip(cen, cnt), key=lambda x: -x[1])]


def vision(paths):
    out = {}
    if not paths or not os.path.exists(VT):
        return out
    for j in range(0, len(paths), 40):
        r = subprocess.run([VT, *paths[j:j + 40]], capture_output=True, text=True)
        for line in r.stdout.splitlines():
            try:
                o = json.loads(line); out[o["file"]] = o
            except Exception:
                pass
    return out


def region_of(lay):
    """The A-roll and the B-roll area of a layout, as (y0, y1) rows of the 960 frame."""
    if lay == "split":
        return (480, 960), (0, 480)
    if lay == "a_full":
        return (0, 960), None
    return None, (0, 960)


pct = lambda x: f"{round(x * 100)}%"
cap1 = lambda t: t[:1].upper() + t[1:]
comp = {}

# ---------------------------------------------------------------- PACE
lens = [round(s["t1"] - s["t0"], 3) for s in shots]
lens_arr = np.array(lens) if lens else np.array([dur])
bins = [0, 0.5, 1, 2, 3, 5, 1e9]
hist = [int(((lens_arr >= bins[k]) & (lens_arr < bins[k + 1])).sum()) for k in range(len(bins) - 1)]
wstarts = np.array([w["t0"] for w in words] + [w["t1"] for w in words]) if words else np.array([])
on_word = 0
for c in cuts:
    t = c / FPS
    if len(wstarts) and np.min(np.abs(wstarts - t)) <= 0.12:
        on_word += 1
hook_cuts = sum(1 for c in cuts if c / FPS < 3)
win = []
for k in range(int(np.ceil(dur / 5))):
    win.append(sum(1 for c in cuts if k * 5 <= c / FPS < (k + 1) * 5))
med = float(np.median(lens_arr))
speed = "Very fast" if med < 1.2 else "Fast" if med < 2.2 else "Steady" if med < 4 else "Slow"
comp["pace"] = {
    "headline": f"{speed}: a new shot every {med:.1f} s",
    "specs": [["Cuts a minute", f"{a['stats']['cuts_per_min']:.0f}"], ["Median shot", f"{med:.1f} s"],
              ["Shortest / longest", f"{lens_arr.min():.1f} s / {lens_arr.max():.1f} s"],
              ["Cuts in the first 3 s", str(hook_cuts)],
              ["Cuts on a spoken word", pct(on_word / max(1, len(cuts)))], ["Words a second", f"{a['stats']['words_per_sec']:.1f}"]],
    "data": {"lens": lens, "hist": hist, "hist_labels": ["<0.5", "0.5-1", "1-2", "2-3", "3-5", "5+"], "per5s": win,
             "cuts": [round(c / FPS, 3) for c in cuts], "duration": round(dur, 2), "on_word": round(on_word / max(1, len(cuts)), 3)},
    "rules": [f"Cut to a new shot every {med:.1f} s on average ({a['stats']['cuts_per_min']:.0f} cuts a minute).",
              f"Put {hook_cuts} cuts in the first 3 seconds.",
              f"Cut on a spoken word {pct(on_word / max(1, len(cuts)))} of the time." if words else "Cut on the beat of the edit."],
}
log("step deep pace")

# ---------------------------------------------------------------- LAYOUT
share = a["stats"]["layout_share"]
seam_rows = []
for s in shots:
    if s["layout"] != "split":
        continue
    f = full_keep.get((s["f0"] + s["f1"]) // 2)
    if f is None:
        continue
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
    rd = np.abs(np.diff(g, axis=0)).mean(axis=1)
    lo, hi = int(H * 0.3), int(H * 0.7)
    seam_rows.append((lo + int(np.argmax(rd[lo:hi]))) / H)
seam = round(float(np.median(seam_rows)), 3) if seam_rows else None
switches = max(0, len(a["layout_runs"]) - 1)
main = max(share, key=share.get)
ins_share = len({f for x in INS for f in range(x["f0"], x["f1"])}) / max(1, N)   # frames covered once (cards overlap)
INS_WHERE = {"behind": "a picture behind the speaker", "background": "a picture in place of the room", "front": "a picture in front of the speaker", "beside": "a picture beside the speaker"}
NAMES = {"split": "stacked split screen", "a_full": "full-frame talking head", "b_full": "full-screen B-roll"}
lay_head = {"split": f"Stacked split: B-roll on top, speaker below ({pct(share['split'])})",
            "a_full": f"Full-frame talking head ({pct(share['a_full'])})",
            "b_full": f"Full-screen B-roll ({pct(share['b_full'])})"}[main]
if main == "a_full" and ins_share > 0.08:
    lay_head = f"Talking head with B-roll pictures around the speaker ({pct(ins_share)} of the time)"
comp["layout"] = {
    "headline": lay_head,
    "specs": [["Split screen", pct(share["split"])], ["Full-frame speaker", pct(share["a_full"])], ["Full-screen B-roll", pct(share["b_full"])],
              ["Pictures inside speaker shots", pct(ins_share)],
              ["Seam", f"{round(seam * 100)}% from the top" if seam else "none"], ["Layout changes", str(switches)],
              ["Changes a minute", f"{switches / dur * 60:.1f}"]],
    "data": {"share": share, "seam": seam, "runs": [[r["layout"], r["t0"], r["t1"]] for r in a["layout_runs"]], "main": main,
             "inserts": INS, "inserts_share": round(ins_share, 3)},
    "rules": [f"Main layout: {NAMES[main]} for {pct(share[main])} of the video."] +
             ([f"Split the frame at {round(seam * 100)}% from the top: B-roll above, the speaker below."] if seam and share["split"] > 0.1 else []) +
             ([f"Break the split with a full-frame speaker shot {pct(share['a_full'])} of the time (punch-ins for the big lines)."] if share["a_full"] > 0.02 and main == "split" else []) +
             ([f"Use full-screen B-roll {pct(share['b_full'])} of the time."] if share["b_full"] > 0.02 else []) +
             ([f"Inside speaker shots, show {', '.join(sorted({INS_WHERE[x['kind']] for x in INS}))} ({pct(ins_share)} of the time)."] if INS else []),
}
log("step deep layout")

# ---------------------------------------------------------------- PERSON framing (+ wardrobe)
ar_shots = [s for s in shots if s["layout"] != "b_full"]
crop_paths, crop_meta = [], []
heat = np.zeros((480, 270), np.float32); heat_n = 0
torso_px = []
for s in ar_shots:
    fi = (s["f0"] + s["f1"]) // 2
    f = full_keep.get(fi)
    if f is None:
        continue
    ar, _ = region_of(s["layout"])
    y0, y1 = ar
    reg = f[y0:y1]
    pth = f"{P}/aroll_{s['i']:03d}.jpg"
    cv2.imwrite(pth, reg, [cv2.IMWRITE_JPEG_QUALITY, 85])
    crop_paths.append(pth); crop_meta.append((s, y0, y1))
    m = matte(fi)[y0:y1]
    heat += cv2.resize(m, (270, 480)).astype(np.float32) / 255; heat_n += 1
    ys, xs = np.where(m > 128)
    if len(ys) > 200:
        top, bot = ys.min(), ys.max()
        band = (ys > top + (bot - top) * 0.55)
        if band.sum() > 50:
            torso_px.append(reg[ys[band], xs[band]])
vis = vision(crop_paths)
faces = []
for pth, (s, y0, y1) in zip(crop_paths, crop_meta):
    v = vis.get(os.path.basename(pth))
    if v and v["faces"]:
        fc = max(v["faces"], key=lambda q: q["w"] * q["h"])
        faces.append({"shot": s["i"], "h": fc["h"], "eye_y": fc["eye_y"], "cx": fc["x"] + fc["w"] / 2, "top": fc["y"], "yaw": fc["yaw"]})
def size_of(fh):
    return "extreme close-up" if fh > 0.42 else "close-up" if fh > 0.27 else "medium close-up" if fh > 0.16 else "medium shot" if fh > 0.09 else "wide shot"
sizes = Counter(size_of(q["h"]) for q in faces)
face_by_shot = {q["shot"]: q["h"] for q in faces}
eye = float(np.median([q["eye_y"] for q in faces])) if faces else None
cx = float(np.median([q["cx"] for q in faces])) if faces else None
fh_med = float(np.median([q["h"] for q in faces])) if faces else 0
head_tops = [s["framing"]["head_top"] for s in ar_shots if s.get("framing")]
headroom = None
if faces:
    # headroom = the space above the head: face top minus about 0.35 face heights of hair
    headroom = float(np.median([max(0.0, q["top"] - q["h"] * 0.35) for q in faces]))
side = "centred" if cx is not None and abs(cx - 0.5) < 0.08 else ("left of centre" if cx is not None and cx < 0.5 else "right of centre")
if heat_n:
    hm = (heat / heat_n)
    col = cv2.applyColorMap((np.clip(hm, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    alpha = (np.clip(hm * 1.4, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(f"{P}/framing_heat.png", np.dstack([col, alpha]))
wardrobe = kmeans_cols(np.vstack(torso_px), 3) if torso_px else []
main_size = sizes.most_common(1)[0][0] if sizes else "no speaker found"
looks = "talks straight to the camera" if faces and np.median([abs(q["yaw"]) for q in faces]) < 0.3 else "looks off camera"
person_keys = [os.path.basename(p) for p in crop_paths[:: max(1, len(crop_paths) // 6)][:6]]
comp["person"] = {
    "headline": (f"{main_size.capitalize()}, {side}, eyes {round(eye * 100)}% from the top" if eye is not None else "No speaker on camera"),
    "specs": [["Shot size", main_size], ["Face height", f"{round(fh_med * 100)}% of the frame" if faces else "-"],
              ["Eye line", f"{round(eye * 100)}% from the top" if eye is not None else "-"],
              ["Headroom", f"{round(headroom * 100)}%" if headroom is not None else "-"],
              ["Position", side], ["Eyes", looks if faces else "-"],
              ["Wardrobe", ", ".join(cname(c["hex"]) for c in wardrobe[:2]) if wardrobe else "-"]],
    "data": {"sizes": dict(sizes), "eye_y": eye, "cx": cx, "face_h": fh_med, "headroom": headroom,
             "heat": "parts/framing_heat.png" if heat_n else None, "wardrobe": wardrobe, "crops": [f"parts/{k}" for k in person_keys],
             "area": "bottom" if share["split"] > 0.5 else "full"},
    "rules": ([f"Frame the speaker as a {main_size}, {side}.", f"Put the eyes {round(eye * 100)}% from the top of the speaker's area.",
               f"Leave about {round((headroom or 0) * 100)}% headroom above the head.", f"The speaker {looks}."] if faces else ["No speaker on camera."]) +
             ([f"Wardrobe: plain {cname(wardrobe[0]['hex'])} (nothing that competes with the face)."] if wardrobe else []),
}
log("step deep person")

# ---------------------------------------------------------------- B-ROLL (what) + B-ROLL framing (where, how it moves)
UI = {"screenshot", "computer", "monitor", "laptop", "document", "text", "website", "consumer_electronics", "display", "television",
      "computer_monitor", "electronics", "screen", "machine", "keyboard", "cellphone", "phone", "map", "diagram", "chart"}
br_shots = [s for s in shots if s["layout"] != "a_full"]
bpaths, bmeta = [], []
for s in br_shots:
    fi = (s["f0"] + s["f1"]) // 2
    f = full_keep.get(fi)
    if f is None:
        continue
    _, br = region_of(s["layout"])
    reg = f[br[0]:br[1]]
    pth = f"{P}/broll_{s['i']:03d}.jpg"
    cv2.imwrite(pth, reg, [cv2.IMWRITE_JPEG_QUALITY, 85])
    bpaths.append(pth); bmeta.append((s, br, reg))
for k, ins in enumerate(INS):
    f = full_keep.get((ins["f0"] + ins["f1"]) // 2)
    if f is None:
        continue
    x0, y0, x1, y1 = ins["rect"]
    reg = f[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)]
    if reg.size == 0:
        continue
    pth = f"{P}/broll_in_{k:03d}.jpg"
    cv2.imwrite(pth, reg, [cv2.IMWRITE_JPEG_QUALITY, 85])
    s_ = {"i": 1000 + k, "t0": ins["t0"], "t1": ins["t1"], "f0": ins["f0"], "f1": ins["f1"], "layout": "insert", "ins": ins}
    bpaths.append(pth); bmeta.append((s_, (int(y0 * H), int(y1 * H)), reg))
bvis = vision(bpaths)


def flatness(img):
    g = cv2.cvtColor(cv2.resize(img, (128, int(128 * img.shape[0] / img.shape[1]))), cv2.COLOR_BGR2GRAY).astype(np.float32)
    hh, ww = g.shape[0] // 8 * 8, 128
    blk = g[:hh].reshape(hh // 8, 8, ww // 8, 8).std(axis=(1, 3))
    return float((blk < 2.5).mean())


def shot_move(s, rows):
    """The camera move inside a shot, from optical flow on the small frames: zoom (divergence) and pan."""
    y0, y1 = rows[0] * 240 // 960, rows[1] * 240 // 960
    zs, px, py, mags = [], [], [], []
    for k in range(s["f0"] + 1, s["f1"], 2):
        if k >= N:
            break
        a0, a1 = small[k - 1][y0:y1], small[k][y0:y1]
        fl = cv2.calcOpticalFlowFarneback(a0, a1, None, 0.5, 2, 9, 2, 5, 1.1, 0)
        hh, ww = fl.shape[:2]
        yy, xx = np.mgrid[0:hh, 0:ww]
        rx, ry = xx - ww / 2, yy - hh / 2
        rn = np.sqrt(rx ** 2 + ry ** 2) + 1e-3
        zs.append(float(((fl[..., 0] * rx + fl[..., 1] * ry) / rn).mean()))
        px.append(float(fl[..., 0].mean())); py.append(float(fl[..., 1].mean()))
        mags.append(float(np.linalg.norm(fl, axis=2).mean()))
    if not zs:
        return "static", 0.0
    z, x, y, m = np.median(zs), np.median(px), np.median(py), np.median(mags)
    if z > 0.06:
        return "push-in", float(z)
    if z < -0.06:
        return "pull-out", float(z)
    if abs(x) > 0.25 or abs(y) > 0.25:
        return ("pan" if abs(x) >= abs(y) else "tilt"), float(max(abs(x), abs(y)))
    if m > 0.6:
        return "handheld / moving subject", float(m)
    return "static", float(m)


items = []
for pth, (s, br, reg) in zip(bpaths, bmeta):
    v = bvis.get(os.path.basename(pth), {"labels": [], "faces": []})
    labels = [l[0] for l in v["labels"]]
    flat = flatness(reg)
    if flat > 0.42 or (set(labels[:4]) & UI and flat > 0.2):
        kind = "screen / UI"
    elif v["faces"] or "people" in labels[:2] or "adult" in labels[:2]:
        kind = "people"
    elif flat > 0.28:
        kind = "graphic / text card"
    else:
        kind = "footage"
    gray = cv2.cvtColor(reg, cv2.COLOR_BGR2GRAY)
    rows_dark = (gray.mean(axis=1) < 14)
    bars = int(rows_dark[: len(rows_dark) // 3].sum() + rows_dark[-len(rows_dark) // 3:].sum())
    mv, amt = shot_move(s, br)
    tag = next((l.replace("_", " ") for l in labels if l not in ("people", "adult", "structure", "machine", "consumer_electronics")), labels[0].replace("_", " ") if labels else "")
    items.append({"shot": s["i"], "t0": s["t0"], "t1": s["t1"], "file": f"parts/{os.path.basename(pth)}", "kind": kind,
                  "labels": labels[:5], "tag": tag, "move": mv, "letterbox": bars > reg.shape[0] * 0.12,
                  "where": "top half" if s["layout"] == "split" else (s["ins"].get("where") or {"behind": "behind the speaker", "background": "in place of the room",
                           "front": "in front of the speaker", "beside": "beside the speaker"}[s["ins"]["kind"]]) if s["layout"] == "insert" else "full screen",
                  "rect": s["ins"]["rect"] if s["layout"] == "insert" else None})
items.sort(key=lambda x: x["t0"])
kinds = Counter(x["kind"] for x in items)
tags = Counter(x["tag"] for x in items if x["tag"])
blen = [x["t1"] - x["t0"] for x in items]
bmed = float(np.median(blen)) if blen else 0
kind_txt = " + ".join(k for k, _ in kinds.most_common(2)) if kinds else "none"
comp["broll"] = {
    "headline": (f"{cap1(kind_txt)}, a new clip every {bmed:.1f} s" if items else "No B-roll"),
    "specs": [["B-roll clips", str(len(items))], ["Clip length", f"{bmed:.1f} s"]] +
             [[cap1(k), pct(n / max(1, len(items)))] for k, n in kinds.most_common(4)] +
             [["Common subjects", ", ".join(t for t, _ in tags.most_common(4)) or "-"]],
    "data": {"items": items, "kinds": dict(kinds), "tags": dict(tags.most_common(10)), "median": bmed},
    "rules": ([f"Change the B-roll every {bmed:.1f} s.", f"Mix: " + ", ".join(f"{k} {pct(n / len(items))}" for k, n in kinds.most_common()) + ".",
               "Show the real thing the speaker names (the product on screen, the place, the person)."] if items else ["No B-roll."]),
}
moves = Counter(x["move"] for x in items)
where = Counter(x["where"] for x in items)
lb = sum(1 for x in items if x["letterbox"])
comp["broll_framing"] = {
    "headline": (f"{where.most_common(1)[0][0].capitalize()}, edge to edge, {moves.most_common(1)[0][0]} moves" if items else "No B-roll"),
    "specs": [[w.capitalize(), pct(n / max(1, len(items)))] for w, n in where.most_common()] +
             [["Fills its area", pct(1 - lb / max(1, len(items)))], ["Letterboxed", pct(lb / max(1, len(items)))]] +
             [[f"Move: {m}", pct(n / max(1, len(items)))] for m, n in moves.most_common(3)],
    "data": {"where": dict(where), "moves": dict(moves), "letterbox": lb, "count": len(items),
             "rect": [0, 0, 1, seam or 0.5] if share["split"] > 0.3 else
                     ([round(float(np.median([x["rect"][j] for x in items if x["rect"]])), 3) for j in range(4)]
                      if sum(1 for x in items if x["rect"]) > len(items) / 2 else [0, 0, 1, 1])},
    "rules": ([f"Place B-roll in the {where.most_common(1)[0][0]}" + (f" (0 to {round((seam or 0.5) * 100)}% of the height)." if share['split'] > 0.3 else "."),
               "Crop each clip to fill its area (no black bars)." if lb < len(items) * 0.3 else "Letterbox the clips inside the area.",
               "Camera moves inside B-roll: " + ", ".join(f"{m} {pct(n / len(items))}" for m, n in moves.most_common(3)) + "."] if items else []),
}
log("step deep broll")

# ---------------------------------------------------------------- COLOUR GRADE (the speaker's footage; B-roll separately)
def grade_of(imgs):
    if not imgs:
        return None
    px = np.vstack([im.reshape(-1, 3) for im in imgs]).astype(np.uint8)
    lab = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    L = lab[:, 0] * 100 / 255
    hsv = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    q = np.percentile(L, [1, 25, 50, 75, 99])
    def tone(mask):
        if mask.sum() < 20:
            return "#808080"
        m = px[mask].mean(axis=0)
        return hexof(m)
    def tint(mask):
        if mask.sum() < 20:
            return [0.0, 0.0]
        return [round(float(lab[mask, 1].mean() - 128), 1), round(float(lab[mask, 2].mean() - 128), 1)]
    sh, mi, hi = L < q[1], (L >= q[1]) & (L <= q[3]), L > q[3]
    hist = np.histogram(L, bins=32, range=(0, 100))[0]
    return {"black": round(float(q[0]), 1), "white": round(float(q[4]), 1), "mid": round(float(q[2]), 1),
            "contrast": round(float(q[4] - q[0]), 1), "sat": round(float(hsv[:, 1].mean() / 255), 3),
            "warmth": round(float(lab[:, 2].mean() - 128), 1), "tint_green_magenta": round(float(lab[:, 1].mean() - 128), 1),
            "shadows": tone(sh), "mids": tone(mi), "highlights": tone(hi),
            "shadow_tint": tint(sh), "highlight_tint": tint(hi),
            "hist": [round(float(x) / max(1, hist.max()), 3) for x in hist]}
ar_imgs, br_imgs = [], []
for fi, im in grade_samples:
    ar, br = region_of(layout[min(fi, N - 1)])
    if ar:
        ar_imgs.append(im[ar[0] // 4: ar[1] // 4])
    if br:
        br_imgs.append(im[br[0] // 4: br[1] // 4])
ga, gb = grade_of(ar_imgs), grade_of(br_imgs)
g0 = ga or gb


def tint_word(t):
    a_, b_ = t
    if abs(a_) < 2 and abs(b_) < 2:
        return "neutral"
    ang = np.degrees(np.arctan2(b_, a_)) % 360
    names = [(30, "magenta-red"), (75, "warm orange"), (105, "yellow"), (160, "green"), (220, "teal"), (275, "blue"), (330, "violet"), (360, "magenta-red")]
    return next(n for lim, n in names if ang <= lim)
key = "low-key (dark)" if g0["mid"] < 32 else "high-key (bright)" if g0["mid"] > 62 else "mid-key"
satw = "muted" if g0["sat"] < 0.22 else "rich" if g0["sat"] > 0.42 else "natural"
contw = "soft contrast" if g0["contrast"] < 55 else "punchy contrast" if g0["contrast"] > 80 else "normal contrast"
warmw = "warm" if g0["warmth"] > 6 else "cool" if g0["warmth"] < -3 else "neutral white balance"
comp["grade"] = {
    "headline": f"{key.capitalize()}, {satw}, {tint_word(g0['shadow_tint'])} shadows, {tint_word(g0['highlight_tint'])} highlights",
    "specs": [["Key", key], ["Contrast", f"{contw} ({g0['contrast']:.0f})"], ["Saturation", f"{satw} ({round(g0['sat'] * 100)}%)"],
              ["White balance", warmw], ["Black point", f"L {g0['black']:.0f}"], ["White point", f"L {g0['white']:.0f}"],
              ["Shadow tint", tint_word(g0["shadow_tint"])], ["Highlight tint", tint_word(g0["highlight_tint"])]],
    "data": {"aroll": ga, "broll": gb, "palette": a["palette"], "accent": a.get("accent_palette", [])},
    "rules": [f"Grade the speaker's footage {key}, {satw}, {contw}.", (f"Crush the blacks (black point L {g0['black']:.0f})" if g0['black'] < 3 else f"Lift the blacks to about L {g0['black']:.0f}") + f"; whites near L {g0['white']:.0f}.",
              f"Push the shadows toward {tint_word(g0['shadow_tint'])} and the highlights toward {tint_word(g0['highlight_tint'])}; {warmw}.",
              "Palette: " + ", ".join(c["hex"] for c in a["palette"][:6]) + "."],
}
log("step deep grade")

# ---------------------------------------------------------------- SUBTITLES + TYPOGRAPHY + TEXT COLOUR
def glyph_mask(f, b):
    x0 = int(max(0, (b[0] - b[3] * 0.15) * W)); x1 = int(min(W, (b[0] + b[2] + b[3] * 0.15) * W))
    y0 = int(max(0, (b[1] - b[3] * 0.25) * H)); y1 = int(min(H, (b[1] + b[3] * 1.25) * H))
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    roi = f[y0:y1, x0:x1]
    g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY).astype(np.int16)
    med = np.median(g)
    light = med < 128
    gm = ((g > med + 55) & (g > 140)) if light else ((g < med - 55) & (g < 115))
    return roi, gm.astype(np.uint8), (x0, y0, x1, y1), light


import difflib


def events_of(lst):
    """Merge the 10 fps OCR samples of one caption into one event (same height on screen, near in time, similar text)."""
    ev = []
    for c in sorted(lst, key=lambda c: c["t0"]):
        hit = None
        for e in reversed(ev[-4:]):
            if abs(e["box"][1] - c["box"][1]) < 0.03 and c["t0"] - e["t1"] < 0.16 and \
               difflib.SequenceMatcher(None, e["text"].lower(), c["text"].lower()).ratio() > 0.6:
                hit = e; break
        if hit:
            hit["t1"] = max(hit["t1"], c["t1"])
            if len(c["text"]) > len(hit["text"]):
                hit["text"] = c["text"]
        else:
            ev.append(dict(c))
    return ev


allev = events_of(caps_all)
spoken_h = [c["box"][3] for c in allev if c["kind"] == "caption"]
base_h = float(np.median(spoken_h)) if spoken_h else (float(np.median([c["box"][3] for c in allev])) if allev else 0.04)
cev = [c for c in allev if c["kind"] == "caption" and c["box"][3] < base_h * 1.45]
tev = [c for c in allev if c["box"][3] >= base_h * 1.45 and c["box"][3] >= 0.03]


def text_style(evs, tag, max_crops=8):
    glyph_px, ring_px, out_px, weights, heights, boxes_bg = [], [], [], [], [], []
    crops, upper, nwords, ys, xs, durs = [], [], [], [], [], []
    cwr = []
    seen = set()
    step = max(1, len(evs) // (max_crops * 2))
    pick = set(range(0, len(evs), step))
    for n_, c in enumerate(evs):
        f0 = int(round(c["t0"] * FPS))
        fm = min(N - 1, f0 + 3)
        f = full_keep.get(fm)
        if f is None:
            f = full_keep.get(f0)
        if f is None:
            continue
        gm = glyph_mask(f, c["box"])
        if gm is None:
            continue
        roi, m, (x0, y0, x1, y1), light = gm
        if m.sum() < 30:
            continue
        if tag == "title" and not light:
            # dark text on a bright screen inside the B-roll = text of a screen recording, not a designed title
            _, brr = region_of(layout[min(fm, N - 1)])
            cy = (c["box"][1] + c["box"][3] / 2) * H
            if brr and brr[0] <= cy < brr[1] and np.median(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)) > 170:
                continue
        txt = re.sub(r"\s+", " ", c["text"]).strip()
        letters = [ch for ch in txt if ch.isalpha()]
        if letters:
            upper.append(sum(ch.isupper() for ch in letters) / len(letters))
        nwords.append(len(txt.split()))
        ys.append(c["box"][1] + c["box"][3] / 2); xs.append(c["box"][0] + c["box"][2] / 2)
        durs.append(c["t1"] - c["t0"] + 0.1)
        heights.append(c["box"][3])
        nch = len(txt.replace(" ", ""))
        if nch >= 4 and " " not in txt:
            cwr.append((c["box"][2] * W / nch) / max(1, c["box"][3] * H))
        glyph_px.append((light, roi[m > 0]))
        ring = cv2.dilate(m, np.ones((5, 5), np.uint8)) - m
        ring_px.append(roi[ring > 0])
        outer = cv2.dilate(m, np.ones((15, 15), np.uint8)) - cv2.dilate(m, np.ones((7, 7), np.uint8))
        out_px.append(roi[outer > 0])
        dt = cv2.distanceTransform(m, cv2.DIST_L2, 3)
        stroke = 2 * float(np.percentile(dt[m > 0], 90))
        weights.append(stroke / max(1, c["box"][3] * H))
        bgv = roi[(cv2.dilate(m, np.ones((9, 9), np.uint8)) == 0)]
        boxes_bg.append(float(bgv.std()) if len(bgv) > 30 else 99)
        key_ = txt.lower()
        if n_ in pick and key_ not in seen and len(crops) < max_crops and len(txt) >= 2:
            seen.add(key_)
            pad = int(c["box"][3] * H * 0.45)
            X0, Y0 = int(max(0, c["box"][0] * W - pad)), int(max(0, c["box"][1] * H - pad))
            X1, Y1 = int(min(W, (c["box"][0] + c["box"][2]) * W + pad)), int(min(H, (c["box"][1] + c["box"][3]) * H + pad))
            if X1 - X0 > 10 and Y1 - Y0 > 10:
                name = f"{tag}_{len(crops):02d}.jpg"
                crop = f[Y0:Y1, X0:X1]
                crop = cv2.resize(crop, (int(crop.shape[1] * 2), int(crop.shape[0] * 2)), interpolation=cv2.INTER_CUBIC)
                cv2.imwrite(f"{P}/{name}", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
                crops.append({"file": f"parts/{name}", "text": txt, "t": round(c["t0"], 2)})
    if not heights:
        return None
    nl = sum(1 for l, _ in glyph_px if l)
    maj = nl >= len(glyph_px) - nl
    gp = np.vstack([g for l, g in glyph_px if l == maj] or [g for _, g in glyph_px])
    cols = kmeans_cols(gp, 3)
    ring = np.vstack(ring_px) if ring_px else np.zeros((0, 3))
    outer = np.vstack(out_px) if out_px else np.zeros((0, 3))
    gl, rl, ol = gp.mean(), ring.mean() if len(ring) else 0, outer.mean() if len(outer) else 0
    outline = bool(len(ring) and len(outer) and gl > 128 and rl < gl - 70 and rl < ol - 18)
    wmed = float(np.median(weights))
    weight = "light" if wmed < 0.08 else "regular" if wmed < 0.12 else "bold" if wmed < 0.19 else "black (heavy)"
    up = float(np.median(upper)) if upper else 0
    case = "UPPERCASE" if up > 0.85 else "lowercase" if up < 0.08 else "Sentence case" if up < 0.35 else "Mixed"
    boxed = float(np.median(boxes_bg)) < 9
    mono = bool(len(cwr) >= 6 and np.std(cwr) / max(1e-3, np.mean(cwr)) < 0.09)
    return {"mono": mono, "count": len(heights), "size": float(np.median(heights)), "size_px": round(float(np.median(heights)) * 1920),
            "weight": weight, "stroke": round(wmed, 3), "case": case, "outline": outline, "boxed": boxed,
            "colors": cols, "y": float(np.median(ys)), "x": float(np.median(xs)), "words": float(np.median(nwords)),
            "dur": float(np.median(durs)), "crops": crops, "ys": [round(y, 3) for y in ys], "xs": [round(x, 3) for x in xs],
            "hs": [round(h, 3) for h in heights]}


cs = text_style(cev, "cap")
ts = text_style(tev, "title", 6)
log("step deep text")


def pos_word(y):
    return "top third" if y < 0.33 else "the middle" if y < 0.45 else ("on the seam" if share["split"] > 0.3 else "centre") if y < 0.56 else "lower middle" if y < 0.7 else "bottom third"


if cs:
    nw = cs["words"]
    chunk = "one word at a time" if nw <= 1.2 else f"{int(round(nw))} words at a time" if nw < 4.5 else "full sentences"
    comp["subtitles"] = {
        "headline": f"{chunk.capitalize()}, {cs['case']}, {pos_word(cs['y'])}",
        "specs": [["Words on screen", chunk], ["Case", cs["case"]], ["Position", f"{pos_word(cs['y'])} ({round(cs['y'] * 100)}% down)"],
                  ["Size", f"{cs['size_px']} px line height (1080x1920)"], ["On screen", f"{cs['dur']:.1f} s each"],
                  ["Captions found", str(cs["count"])], ["Style", ("white box behind" if cs["boxed"] else "outline" if cs["outline"] else "no box, no outline")]],
        "data": {"y": cs["y"], "x": cs["x"], "ys": cs["ys"], "xs": cs["xs"], "hs": cs["hs"], "words": nw, "crops": cs["crops"], "case": cs["case"],
                 "size": cs["size"], "dur": cs["dur"]},
        "rules": [f"Show {chunk}, in {cs['case']}.", f"Place the captions {pos_word(cs['y'])}, {round(cs['y'] * 100)}% from the top, centred.",
                  f"Line height about {cs['size_px']} px on a 1080x1920 frame.", f"Each caption stays {cs['dur']:.2f} s, in time with the words."],
    }
else:
    comp["subtitles"] = {"headline": "No subtitles found", "specs": [["Captions found", "0"]], "data": {"crops": []}, "rules": ["No burned-in subtitles."]}

typo_specs, typo_rules = [], []
if cs:
    typo_specs += [["Caption face", "monospace" if cs["mono"] else "proportional"], ["Captions", f"{cs['weight']}, {cs['case']}, {cs['size_px']} px"], ["Caption outline", "yes" if cs["outline"] else "no"],
                   ["Caption box", "yes" if cs["boxed"] else "no"]]
    typo_rules.append(f"Captions: a {cs['weight']} {'monospace' if cs['mono'] else 'sans'} face, {cs['case']}, about {cs['size_px']} px" + (", with an outline" if cs["outline"] else "") + (", on a box" if cs["boxed"] else "") + ".")
if ts:
    typo_specs += [["Titles", f"{ts['weight']}, {ts['case']}, {ts['size_px']} px"], ["Title position", f"{round(ts['y'] * 100)}% down"]]
    typo_rules.append(f"Titles / key words: a {ts['weight']} face, {ts['case']}, about {ts['size_px']} px, {pos_word(ts['y'])}.")
if cs and ts and ts["size_px"] > cs["size_px"] * 1.3:
    typo_rules.append(f"Two sizes: titles about {ts['size_px'] / cs['size_px']:.1f}x the caption size.")
comp["typography"] = {
    "headline": (f"{cs['weight'].capitalize()} {'mono ' if cs['mono'] else ''}{cs['case']} captions" if cs else "No captions") + (f" + {ts['weight']} titles at {ts['size_px'] / max(1, (cs or ts)['size_px']):.1f}x" if ts and cs else ""),
    "specs": typo_specs or [["Text", "none found"]],
    "data": {"caption": {k: cs[k] for k in ("weight", "stroke", "case", "size_px", "outline", "boxed", "mono")} if cs else None,
             "title": {k: ts[k] for k in ("weight", "stroke", "case", "size_px", "outline", "boxed", "y", "mono")} if ts else None,
             "crops": (cs["crops"][:4] if cs else []) + (ts["crops"][:4] if ts else [])},
    "rules": typo_rules or ["No on-screen text."],
}
tc = (cs or ts)
if tc:
    cols = [c for c in tc["colors"] if c["share"] > 0.06]
    main_c = cols[0] if cols else {"hex": "#ffffff", "share": 1}
    hl = None
    for c in cols[1:]:
        r1 = np.array([int(main_c["hex"][i:i + 2], 16) for i in (1, 3, 5)]); r2 = np.array([int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)])
        _, _, s2 = colorsys.rgb_to_hls(*(r2 / 255))
        if np.linalg.norm(r1 - r2) > 90 and s2 > 0.35:
            hl = c; break
    tcols = (ts["colors"] if ts else [])
    comp["textcolor"] = {
        "headline": f"{cname(main_c['hex']).capitalize()} text" + (f", key words in {cname(hl['hex'])}" if hl else "") + (", black outline" if tc["outline"] else ""),
        "specs": [["Main text", f"{main_c['hex']} ({cname(main_c['hex'])})"]] + ([["Highlight", f"{hl['hex']} ({cname(hl['hex'])})"]] if hl else []) +
                 ([["Titles", f"{tcols[0]['hex']} ({cname(tcols[0]['hex'])})"]] if tcols else []) + [["Outline", "black" if tc["outline"] else "none"]],
        "data": {"main": main_c, "highlight": hl, "caption_colors": cs["colors"] if cs else [], "title_colors": tcols},
        "rules": [f"Text color {main_c['hex']} ({cname(main_c['hex'])})."] + ([f"Highlight key words in {hl['hex']}."] if hl else []) +
                 (["Black outline around the letters."] if tc["outline"] else []),
    }
else:
    comp["textcolor"] = {"headline": "No on-screen text", "specs": [], "data": {}, "rules": []}
log("step deep typography")

# ---------------------------------------------------------------- MOTION: transitions, camera moves, punch-ins, caption entrances
trans = Counter()
for c in cuts:
    pre = luma[max(0, c - 4):c].mean() if c > 0 else luma[c]
    spike = luma[c:min(N, c + 3)].max() if c < N else 0
    if spike > pre + 45 and spike > 170:
        trans["white flash"] += 1; continue
    d = [float(np.abs(small[k].astype(np.int16) - small[k - 1].astype(np.int16)).mean()) for k in range(max(1, c - 3), min(N, c + 4))]
    big = sum(1 for x in d if x > 9)
    if big >= 4:
        trans["dissolve / blur"] += 1
    else:
        trans["hard cut"] += 1
ar_moves = Counter()
punch = 0
prev = None
for s in shots:
    if s["layout"] == "b_full" or s["f1"] - s["f0"] < 6:
        prev = None; continue
    ar, _ = region_of(s["layout"])
    mv, _ = shot_move(s, ar)
    ar_moves[mv] += 1
    fh = face_by_shot.get(s["i"])
    if prev is not None and fh and prev[0] == s["layout"] and max(fh, prev[1]) / max(1e-3, min(fh, prev[1])) > 1.25:
        punch += 1
    prev = (s["layout"], fh) if fh else None
# caption entrances
ent = Counter()
for c in cev[:80]:
    f0 = int(round(c["t0"] * FPS))
    b = c["box"]
    x0, x1 = int(max(0, b[0] * W)), int(min(W, (b[0] + b[2]) * W))
    y0, y1 = int(max(0, b[1] * H)), int(min(H, (b[1] + b[3]) * H))
    if x1 - x0 < 8 or y1 - y0 < 8:
        continue
    fr = [full_keep.get(k) for k in range(f0 - 4, f0 + 9)]
    if any(x is None for x in fr):
        continue
    crops_ = [cv2.cvtColor(x[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32) for x in fr]
    ref = crops_[-1]
    d = np.array([np.abs(cc - ref).mean() for cc in crops_])
    if d.max() < 6:
        continue
    lo = d.max() * 0.15
    settled = next((k for k in range(len(d)) if all(d[j] <= lo for j in range(k, len(d)))), len(d) - 1)
    started = next((k for k in range(len(d)) if d[k] < d[0] * 0.85), settled)
    n = settled - started
    if n <= 1:
        ent["cut on"] += 1
    else:
        # a pop grows: the bright area of the box grows over the frames
        areas = [float((cc > 160).mean()) for cc in crops_[started:settled + 1]]
        ent["pop / scale in" if areas[-1] > areas[0] * 1.25 and np.all(np.diff(areas) > -0.02) else "fade / slide in"] += 1
mot = a["motion_curve"]
energy = float(np.mean(mot)) if mot else 0
comp["motion"] = {
    "headline": (cap1(trans.most_common(1)[0][0]) + "s" if trans else "One continuous take") + (f", {punch} punch-ins" if punch else "") +
                (f", captions {ent.most_common(1)[0][0]}" if ent else ""),
    "specs": [[f"Transition: {k}", pct(n / max(1, sum(trans.values())))] for k, n in trans.most_common(3)] +
             [[f"Speaker shots: {k}", pct(n / max(1, sum(ar_moves.values())))] for k, n in ar_moves.most_common(2)] +
             [["Punch-ins (zoom jumps)", str(punch)]] +
             ([[f"Captions: {k}", pct(n / max(1, sum(ent.values())))] for k, n in ent.most_common(2)] if ent else []) +
             [["Motion energy", "high" if energy > 1.2 else "medium" if energy > 0.5 else "low"]],
    "data": {"transitions": dict(trans), "aroll_moves": dict(ar_moves), "punch_ins": punch, "entrances": dict(ent),
             "curve": mot, "cuts": [round(c / FPS, 3) for c in cuts], "duration": round(dur, 2), "energy": round(energy, 3)},
    "rules": [f"Transitions: " + ", ".join(f"{k} {pct(n / max(1, sum(trans.values())))}" for k, n in trans.most_common()) + "."] +
             ([f"Speaker shots: mostly {ar_moves.most_common(1)[0][0]}."] if ar_moves else []) +
             ([f"Use about {punch} punch-ins (a sudden tighter crop on the same take) for the key lines."] if punch else []) +
             ([f"Captions come on: {ent.most_common(1)[0][0]}."] if ent else []),
}
log("step deep motion")

# ---------------------------------------------------------------- SET
sp = a.get("set_palette", [])
set_img = "set_clean.jpg" if os.path.exists(f"{D}/set_clean.jpg") else None
blur = None
if ar_shots:
    vals_bg, vals_p = [], []
    for s in ar_shots[:20]:
        fi = (s["f0"] + s["f1"]) // 2
        f = full_keep.get(fi)
        if f is None:
            continue
        ar, _ = region_of(s["layout"])
        g = cv2.cvtColor(f[ar[0]:ar[1]], cv2.COLOR_BGR2GRAY)
        m = matte(fi)[ar[0]:ar[1]]
        lap = np.abs(cv2.Laplacian(g, cv2.CV_32F))
        bgm = cv2.erode((m < 60).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
        pm = cv2.erode((m > 200).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        if bgm.sum() > 500 and pm.sum() > 500:
            vals_bg.append(float(lap[bgm].mean())); vals_p.append(float(lap[pm].mean()))
    if vals_bg:
        blur = float(np.median(vals_bg) / max(1e-3, np.median(vals_p)))
bg_l = None
if ga:
    bg_l = ga["mid"]
lights = []
for c in sp:
    if c["share"] > 0.08 and cname(c["hex"]) not in [cname(x["hex"]) for x in lights]:
        lights.append(c)
lights = lights[:4]
depth = "shallow (soft background)" if blur is not None and blur < 0.55 else "deep (sharp background)" if blur is not None else "-"
comp["set"] = {
    "headline": (f"{'Dark' if (bg_l or 50) < 32 else 'Bright' if (bg_l or 50) > 62 else 'Mid-tone'} room, lit by " + " + ".join(cname(c["hex"]) for c in lights[:2]) + " light") if lights else "The set, measured",
    "specs": [["Light colors", ", ".join(f"{cname(c['hex'])}" for c in lights) or "-"], ["Depth of field", depth],
              ["Room brightness", f"L {bg_l:.0f}" if bg_l is not None else "-"]],
    "data": {"palette": sp, "image": set_img, "points": a.get("set_points"), "blur": blur, "area": (a.get("set_clean") or {}).get("area")},
    "rules": ([f"Practical lights in the frame: " + ", ".join(f"{cname(c['hex'])} ({c['hex']})" for c in lights) + "."] if lights else []) +
             ([f"Depth of field: {depth}."] if blur is not None else []),
}
log("step deep set")

# ---------------------------------------------------------------- write
ORDER = ["layout", "pace", "person", "broll", "broll_framing", "grade", "subtitles", "typography", "textcolor", "motion", "set"]
TITLE = {"layout": "Layout & format", "pace": "Pace & cuts", "person": "Person framing", "broll": "B-roll", "broll_framing": "B-roll position & framing",
         "grade": "Color grade", "subtitles": "Subtitles", "typography": "Typography", "textcolor": "Text color", "motion": "Motion & animation", "set": "Set & light"}
src_name = a.get("source_name") or ID
thumb = next((f"keys/shot_{q['shot']:03d}.jpg" for q in faces if q["h"] > 0.08), None) or (shots[min(2, len(shots) - 1)]["key"] if shots else None)
out = {"id": ID, "source": src_name, "duration": round(dur, 2), "thumb": thumb,
       "order": ORDER, "titles": TITLE, "components": {k: {"key": k, "title": TITLE[k], **comp[k]} for k in ORDER}}
json.dump(out, open(f"{D}/style.json", "w"), indent=1)
log("step deep done")
for k in ORDER:
    log(f"  {k}: {comp[k]['headline']}")
