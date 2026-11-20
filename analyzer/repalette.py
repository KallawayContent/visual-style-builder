"""repalette.py ID: recompute accent_palette from the shot key frames (no full re-run)."""
import json, sys, glob, os
import cv2, numpy as np
from PIL import Image
SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository folder (works wherever it is unzipped)
D = f"{SM}/data/{sys.argv[1]}"
src = open(f"{SM}/analyzer/analyze.py").read()
start = src.index("def accent_palette"); end = src.index("# whole-video palette")
exec(src[start:end])
keys = sorted(glob.glob(f"{D}/keys/*.jpg"))
mont = np.vstack([cv2.resize(cv2.imread(k), (90, 160)) for k in keys])
a = json.load(open(f"{D}/analysis.json"))
a["accent_palette"] = accent_palette(mont)
json.dump(a, open(f"{D}/analysis.json", "w"), indent=1)
print([c["hex"] for c in a["accent_palette"]])

# set palette: the saturated light colours in the A-roll area (neon, lamps)
cap = cv2.VideoCapture(f"{D}/w.mp4")
px = []
for r in a["layout_runs"]:
    if r["layout"] == "b_full":
        continue
    for f in range(r["f0"], r["f1"], 45):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, fr = cap.read()
        if not ok:
            continue
        area = fr[480:] if r["layout"] == "split" else fr
        hsv = cv2.cvtColor(area, cv2.COLOR_BGR2HSV)
        m = (hsv[..., 1] > 100) & (hsv[..., 2] > 100)
        px.append(area[m])
px = np.vstack(px).astype(np.float32) if px else np.zeros((0, 3), np.float32)
out = []
if len(px) > 100:
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, lab, cen = cv2.kmeans(px, 5, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    cnt = np.bincount(lab.flatten(), minlength=5)
    for c, n in sorted(zip(cen, cnt), key=lambda x: -x[1]):
        out.append({"hex": "#%02x%02x%02x" % (int(c[2]), int(c[1]), int(c[0])), "share": round(float(n) / len(px), 3)})
a["set_palette"] = out
json.dump(a, open(f"{D}/analysis.json", "w"), indent=1)
print("set", [c["hex"] for c in out])
