"""matte_rvm.py ID -> a sharper person matte in data/ID/mattes/ (the Apple Vision mattes move to data/ID/mattes_vision/).
Robust Video Matting (RVM, resnet50; free, local, Apple GPU) reads hair and edges per pixel and keeps a memory between
frames, so the edge does not flicker. Apple Vision's matte is the GATE: RVM counts only where Vision also saw a person.
The memory resets at each hard cut. Writes one matte for each line of times.txt. Needs PyTorch (not in the lite setup).
"""
import os, sys, subprocess
import numpy as np
import torch
import torch.nn.functional as Fn
from PIL import Image

ID = sys.argv[1]
SM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repository folder (works wherever it is unzipped)
D = f"{SM}/data/{ID}"
W, H, FPS = 540, 960, 30.0
times = [float(x) for x in open(f"{D}/times.txt").read().split()]
want = {}  # frame index -> matte index
for j, t in enumerate(times):
    want.setdefault(int(round(t * FPS - 0.5)), j)

# first run: Vision's mattes stay in mattes/ until the new ones are complete (a failed run changes nothing)
FIRST = not os.path.isdir(f"{D}/mattes_vision")
VIS = f"{D}/mattes" if FIRST else f"{D}/mattes_vision"
OUT = f"{D}/mattes_new" if FIRST else f"{D}/mattes"
os.makedirs(OUT, exist_ok=True)
vis_files = sorted(f for f in os.listdir(VIS) if f.endswith(".png"))

if sys.platform == "darwin" and os.path.exists("/etc/ssl/cert.pem"):
    os.environ.setdefault("SSL_CERT_FILE", "/etc/ssl/cert.pem")
try:
    import certifi; os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass
dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
model = torch.hub.load("PeterL1n/RobustVideoMatting", "resnet50", trust_repo=True, skip_validation=True).eval().to(dev)

ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", f"{D}/w.mp4", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                      stdout=subprocess.PIPE)
rec = [None] * 4
prev = None
i = 0
with torch.no_grad():
    while True:
        buf = ff.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        f = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        small = f[::10, ::10].mean(axis=2)
        if prev is not None and np.abs(small - prev).mean() > 28:   # a hard cut: forget the last shot
            rec = [None] * 4
        prev = small
        src = torch.from_numpy(f).to(dev).permute(2, 0, 1).float().div(255).unsqueeze(0)
        fgr, pha, *rec = model(src, *rec, downsample_ratio=0.5)
        if i in want:
            j = want[i]
            a = (pha[0, 0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
            name = vis_files[min(j, len(vis_files) - 1)]
            vm = Image.open(f"{VIS}/{name}").convert("L")
            if vm.size != (W, H):
                vm = vm.resize((W, H))
            g = torch.from_numpy((np.asarray(vm) > 60).astype(np.float32))[None, None].to(dev)
            g = Fn.max_pool2d(g, 25, 1, 12)                                   # dilate 12 px
            g = Fn.avg_pool2d(Fn.avg_pool2d(g, 13, 1, 6, count_include_pad=False), 13, 1, 6, count_include_pad=False)  # soft edge
            out = (a.astype(np.float32) * g[0, 0].cpu().numpy()).clip(0, 255).astype(np.uint8)
            Image.fromarray(out).save(f"{OUT}/{name}")
        i += 1
        if i % 300 == 0:
            print(f"progress rvm {i}", flush=True)
ff.wait()
if FIRST:
    os.rename(f"{D}/mattes", f"{D}/mattes_vision")
    os.rename(OUT, f"{D}/mattes")
print(f"done rvm {ID} {i} frames", flush=True)
