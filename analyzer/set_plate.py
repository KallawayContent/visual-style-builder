"""set_plate.py ID: the empty set. The A-roll camera is locked, so the median of many frames with the person masked out
gives the room without the person. Writes data/ID/set_clean.jpg (the A-roll area) and analysis["set_points"]: where each
set-light colour sits (normalised x, y inside that area)."""
import json, sys, glob, os
import cv2, numpy as np
SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository folder (works wherever it is unzipped)
D = f"{SM}/data/{sys.argv[1]}"
a = json.load(open(f"{D}/analysis.json"))
mattes = sorted(glob.glob(f"{D}/mattes/*.png"))
cap = cv2.VideoCapture(f"{D}/w.mp4")
split = any(r["layout"] == "split" for r in a["layout_runs"]) and a["stats"]["layout_share"]["split"] > 0.5
want = "split" if split else "a_full"
stack, masks = [], []
for r in a["layout_runs"]:
    if r["layout"] != want: continue
    for f in range(r["f0"], r["f1"], 12):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, fr = cap.read()
        if not ok: continue
        m = cv2.imread(mattes[min(f, len(mattes) - 1)], cv2.IMREAD_GRAYSCALE)
        if split: fr, m = fr[480:], m[480:]
        m = cv2.dilate(m, np.ones((25, 25), np.uint8))
        stack.append(fr.astype(np.float32)); masks.append(m < 60)
S = np.stack(stack); M = np.stack(masks)
S[~M] = np.nan
clean = np.nanmedian(S, axis=0)
hole = np.isnan(clean).any(axis=2)
clean = np.nan_to_num(clean).astype(np.uint8)
if hole.any():
    clean = cv2.inpaint(clean, hole.astype(np.uint8) * 255, 9, cv2.INPAINT_TELEA)
cv2.imwrite(f"{D}/set_clean.jpg", clean, [cv2.IMWRITE_JPEG_QUALITY, 92])
# where each set-light colour sits
hsv = cv2.cvtColor(clean, cv2.COLOR_BGR2HSV)
bright = (hsv[..., 1] > 90) & (hsv[..., 2] > 100)
pts = []
for c in a.get("set_palette", []):
    rgb = np.array([int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)])[::-1]
    d = np.linalg.norm(clean.astype(np.int32) - rgb, axis=2)
    m = ((d < 38) & bright).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        pts.append(None); continue
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    pts.append({"hex": c["hex"], "x": round(float(cen[k][0] / clean.shape[1]), 3), "y": round(float(cen[k][1] / clean.shape[0]), 3)})
a["set_points"] = pts; a["set_clean"] = {"file": "set_clean.jpg", "area": "bottom" if split else "full", "frames": len(stack)}
json.dump(a, open(f"{D}/analysis.json", "w"), indent=1)
print(len(stack), "frames", pts)
