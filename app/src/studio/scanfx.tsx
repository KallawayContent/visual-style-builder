// The scan animation over the flat video. It reads the real video every frame (live.video = the packed 3 x 2 video).
//   grid   the frame as a grid of sampled pixels that light up in the real color as a wave passes (the default)
//   edges  the edge map traced in light where pulses pass, + motion sparks
//   mesh   sample points linked to their neighbours that light up in a cascade, + reticles with read-outs
import { useEffect, useRef } from "react";
import { live } from "./Stage3D";

export type ScanKind = "grid" | "edges" | "mesh";
export const SCAN_KINDS: { id: ScanKind; name: string }[] = [{ id: "grid", name: "Pixel grid" }, { id: "edges", name: "Edge trace" }, { id: "mesh", name: "Point mesh" }];

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
// a smooth moving field 0..1 (two drifting waves + a slow sweep), for "where the attention is" this frame
function field(u: number, v: number, t: number) {
  const a = Math.sin(u * 6.0 + t * 1.7) * Math.cos(v * 4.0 - t * 1.1);
  const b = Math.sin((u + v) * 5.0 - t * 2.3);
  const sweep = Math.exp(-Math.pow(((v - ((t * 0.32) % 1.4) + 0.2)) * 5, 2));
  return Math.max(0, Math.min(1, 0.5 + 0.28 * a + 0.22 * b)) * 0.75 + sweep * 0.6;
}

export default function ScanFX({ kind, w, h, amt }: { kind: ScanKind; w: number; h: number; amt: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const amtRef = useRef(amt); amtRef.current = amt;
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // small read-back canvases: the source cell and the edge / motion cells
    const SW = 36, SH = 64;
    const sc = document.createElement("canvas"); sc.width = SW; sc.height = SH; const sg = sc.getContext("2d", { willReadFrequently: true })!;
    const ec = document.createElement("canvas"); ec.width = 270; ec.height = 480; const eg = ec.getContext("2d", { willReadFrequently: true })!;
    const mc = document.createElement("canvas"); mc.width = SW; mc.height = SH; const mg = mc.getContext("2d", { willReadFrequently: true })!;
    // mesh points (stratified random) + 3 nearest neighbours each, and a cascade order
    const pts: { x: number; y: number; r: number; nb: number[] }[] = [];
    const GX = 13, GY = 20;
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) pts.push({ x: (i + 0.15 + 0.7 * hash(i, j)) / GX, y: (j + 0.15 + 0.7 * hash(j + 9, i + 3)) / GY, r: hash(i * 3.1, j * 7.7), nb: [] });
    pts.forEach((p) => { p.nb = pts.map((q, k) => [k, (q.x - p.x) ** 2 + ((q.y - p.y) * 1.78) ** 2] as [number, number]).sort((a, b) => a[1] - b[1]).slice(1, 4).map((x) => x[0]); });
    const ret = [0, 1, 2].map((k) => ({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, next: 0, k }));
    let raf = 0; const t0 = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = (performance.now() - t0) / 1000;
      const A = amtRef.current;
      g.clearRect(0, 0, w, h);
      const v = live.video;
      if (!v || v.readyState < 2 || A < 0.01) return;
      const cw = v.videoWidth / 3, ch = v.videoHeight / 2;
      sg.drawImage(v, 0, 0, cw, ch, 0, 0, SW, SH);
      const src = sg.getImageData(0, 0, SW, SH).data;
      const col = (u: number, vv: number) => { const x = Math.min(SW - 1, Math.max(0, Math.floor(u * SW))), y = Math.min(SH - 1, Math.max(0, Math.floor(vv * SH))); const o = (y * SW + x) * 4; return [src[o], src[o + 1], src[o + 2]]; };
      const hex = (c: number[]) => "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
      g.save(); g.globalAlpha = A;
      if (kind === "grid") {
        const cs = w / 27, rows = Math.ceil(h / cs);
        g.font = `600 ${Math.max(7, cs * 0.28)}px "JetBrains Mono", monospace`;
        for (let j = 0; j < rows; j++) for (let i = 0; i < 27; i++) {
          const u = (i + 0.5) / 27, vv = (j + 0.5) * cs / h;
          const f = field(u, vv, t);
          if (f < 0.42) continue;
          const k = (f - 0.42) / 0.58;
          const c = col(u, vv);
          g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 * k})`;
          const pad = cs * (0.5 - 0.42 * k);
          g.fillRect(i * cs + pad, j * cs + pad, cs - pad * 2, cs - pad * 2);
          g.strokeStyle = `rgba(255,255,255,${0.28 * k})`; g.lineWidth = 0.6;
          g.strokeRect(i * cs + 1, j * cs + 1, cs - 2, cs - 2);
          if (k > 0.82 && hash(i + Math.floor(t * 2), j) > 0.9) { g.fillStyle = `rgba(255,255,255,${0.85 * k})`; g.fillText(hex(c).slice(1, 5), i * cs + 2, j * cs + cs * 0.62); }
        }
        g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = 0.5;
        for (let i = 1; i < 27; i++) { g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, h); g.stroke(); }
        for (let j = 1; j < rows; j++) { g.beginPath(); g.moveTo(0, j * cs); g.lineTo(w, j * cs); g.stroke(); }
      } else if (kind === "edges") {
        eg.clearRect(0, 0, 270, 480);
        eg.drawImage(v, cw * 2, ch, cw, ch, 0, 0, 270, 480);
        // the edge map has a black background: turn it into cyan lines on transparency (black darkened the video)
        const id = eg.getImageData(0, 0, 270, 480), dd = id.data;
        for (let o = 0; o < dd.length; o += 4) { const l = dd[o]; dd[o] = 110; dd[o + 1] = 235; dd[o + 2] = 255; dd[o + 3] = l > 40 ? l : 0; }
        eg.putImageData(id, 0, 0);
        g.save();
        const pulses = [0, 1, 2, 3].map((k) => ({ x: 0.5 + 0.38 * Math.sin(t * (0.7 + k * 0.23) + k * 2), y: 0.5 + 0.42 * Math.cos(t * (0.5 + k * 0.17) + k), r: 0.32 + 0.1 * Math.sin(t + k) }));
        g.beginPath();
        pulses.forEach((p) => { g.moveTo(p.x * w + p.r * w, p.y * h); g.arc(p.x * w, p.y * h, p.r * w, 0, Math.PI * 2); });
        const sy = ((t * 0.3) % 1.3 - 0.15) * h; g.rect(0, sy - h * 0.06, w, h * 0.12);
        g.clip();
        g.globalAlpha = 0.7 * A;
        g.drawImage(ec, 0, 0, w, h);
        g.restore();
        // motion sparks
        mg.drawImage(v, cw, ch, cw, ch, 0, 0, SW, SH);
        const md = mg.getImageData(0, 0, SW, SH).data;
        for (let y = 0; y < SH; y += 2) for (let x = 0; x < SW; x += 2) {
          const m = md[(y * SW + x) * 4] / 255;
          if (m < 0.35) continue;
          const px = (x + 0.5) / SW * w, py = (y + 0.5) / SH * h, a = Math.min(1, (m - 0.35) * 2);
          g.fillStyle = `rgba(255,${Math.round(180 - 100 * a)},${Math.round(200 - 60 * a)},${0.7 * a})`;
          g.fillRect(px - 1.5, py - 1.5, 3, 3);
          g.strokeStyle = `rgba(255,255,255,${0.25 * a})`; g.beginPath(); g.moveTo(px, py); g.lineTo(px + 6 * Math.cos(x + t * 3), py + 6 * Math.sin(y + t * 3)); g.stroke();
        }
      } else {
        // mesh: lines, then points (the color under each point), lit in a cascade
        const lit = (p: { r: number }) => { const ph = (t * 0.45 + p.r) % 1; return ph < 0.35 ? Math.sin((ph / 0.35) * Math.PI) : 0; };
        g.lineWidth = 0.6;
        pts.forEach((p) => {
          const lp = lit(p);
          p.nb.forEach((k) => { const q = pts[k]; const l = Math.max(lp, lit(q)); g.strokeStyle = `rgba(255,255,255,${0.05 + 0.25 * l})`; g.beginPath(); g.moveTo(p.x * w, p.y * h); g.lineTo(q.x * w, q.y * h); g.stroke(); });
        });
        pts.forEach((p) => {
          const lp = lit(p), c = col(p.x, p.y);
          g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
          g.beginPath(); g.arc(p.x * w, p.y * h, 1.6 + 2.2 * lp, 0, Math.PI * 2); g.fill();
          g.strokeStyle = `rgba(255,255,255,${0.25 + 0.6 * lp})`; g.lineWidth = 0.8; g.stroke();
        });
        // reticles: hop between bright / busy points
        g.font = `500 10px "JetBrains Mono", monospace`;
        ret.forEach((r) => {
          if (t > r.next) { const p = pts[Math.floor(hash(t * 13.1, r.k * 7.3) * pts.length)]; r.tx = p.x; r.ty = p.y; r.next = t + 0.9 + r.k * 0.35; }
          r.x += (r.tx - r.x) * 0.14; r.y += (r.ty - r.y) * 0.14;
          const x = r.x * w, y = r.y * h, s = 11;
          g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.2;
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { g.beginPath(); g.moveTo(x + a * s, y + b * s * 0.4); g.lineTo(x + a * s, y + b * s); g.lineTo(x + a * s * 0.4, y + b * s); g.stroke(); });
          const c = col(r.x, r.y);
          g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(x + s + 4, y - 9, 92, 18);
          g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x + s + 7, y - 5, 10, 10);
          g.fillStyle = "#fff"; g.fillText(`${hex(c)} ${r.x.toFixed(2)},${r.y.toFixed(2)}`, x + s + 21, y + 4);
        });
      }
      g.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, w, h]);
  return <canvas ref={cv} className="sfx" style={{ width: w, height: h }} />;
}
