// The live 9:16 card of one saved part: the real layer of its video (the plate shader) playing a short loop, + helpers.
import { useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { makePlateMaterial } from "../plateMaterial";
import { PW, PH, makeVideo, layoutAt, capBox } from "./Stage3D";
import { COMP_ORDER, COMP_SHORT, LAYER_OF, Pick, Saved, Style, loadStyle, writeLib } from "./model";

export type VidData = { style: Style; analysis: any; heroT: number };
const cache = new Map<string, Promise<VidData>>();
export function useVid(vid: string, heroTime: (a: any, s: Style) => number) {
  const [d, setD] = useState<VidData | null>(null);
  useEffect(() => {
    let live = true;
    if (!cache.has(vid)) cache.set(vid, Promise.all([loadStyle(vid), fetch(`/data/${vid}/analysis.json`).then((r) => r.json())])
      .then(([style, analysis]) => ({ style, analysis, heroT: heroTime(analysis, style) })));
    setD(null);
    cache.get(vid)!.then((x) => live && setD(x));
    return () => { live = false; };
  }, [vid]);
  return d;
}

export const savedOrder = (lib: Saved[]) => COMP_ORDER.flatMap((k) => lib.filter((s) => s.key === k).sort((a, b) => a.at - b.at));
export const cardLive = { vt: 0 };

export function Fit() {
  const { camera, size } = useThree();
  useFrame(() => { const c = camera as THREE.OrthographicCamera; c.zoom = Math.min(size.height / PH, size.width / PW); c.updateProjectionMatrix(); });
  return null;
}

export function CardPlate({ s, d }: { s: Saved; d: VidData }) {
  const L = LAYER_OF[s.key];
  const V = useMemo(() => makeVideo(`/data/${s.vid}/packed.mp4`), [s.vid]);
  const t0 = Math.max(0, d.heroT - 3), t1 = d.heroT + 1;
  useEffect(() => {
    const go = () => { V.v.currentTime = t0; V.v.play().catch(() => {}); };
    V.v.addEventListener("loadedmetadata", go, { once: true }); V.v.load();
    return () => { V.v.pause(); V.v.removeAttribute("src"); V.v.load(); V.tex.dispose(); };
  }, [V]);
  const geo = useMemo(() => new THREE.PlaneGeometry(PW, PH), []);
  const mat = useMemo(() => {
    const m = makePlateMaterial(V.tex, L.kind);
    m.uniforms.uAccent.value.set(L.color);
    if (L.id === "grade") {
      const ps = (d.style.components.grade?.data?.palette || []).map((x: any) => x.hex);
      while (ps.length < 6) ps.push(ps[ps.length - 1] || "#000000");
      m.uniforms.uPal.value = ps.slice(0, 6).map((h: string) => new THREE.Color(h));
    }
    if (L.id === "format") m.uniforms.uRegionTint.value = 1;
    return m;
  }, [V, L, d]);
  useEffect(() => () => mat.dispose(), [mat]);
  const runs = d.analysis?.layout_runs || [], caps = d.analysis?.captions || [];
  useFrame(({ clock }) => {
    const v = V.v;
    if (v.readyState >= 1 && (v.currentTime > t1 || v.ended)) { v.currentTime = t0; v.play().catch(() => {}); }
    const vt = v.currentTime; cardLive.vt = vt;
    const u = mat.uniforms, lay = layoutAt(runs, vt), box = capBox(caps, vt);
    u.uOpacity.value = 1; u.uFill.value = 0.86; u.uBorder.value = 0.6; u.uFlash.value = 0;
    u.uLayout.value = lay; u.uTime.value = clock.elapsedTime;
    u.uRemove.value = 1; u.uHole.value = 0.7; u.uOutline.value = L.id === "set" ? 0.8 : 0;
    u.uGhost.value = Math.max(L.id === "motion" ? 0.85 : L.id === "grade" ? 1 : 0, 0.9);
    u.uCtxLift.value = 0.25;
    if (L.id === "text" && box) { u.uBoxOn.value = 1; u.uBox.value.set(box[0], 1 - box[3], box[2], 1 - box[1]); }
    else if (L.id === "broll" && lay === 1) { u.uBoxOn.value = 0.9; u.uBox.value.set(0.015, 0.507, 0.985, 0.99); }
    else u.uBoxOn.value = 0;
  });
  return <mesh geometry={geo} material={mat} />;
}

type P = {
  items: Saved[]; idx: number; setIdx: (i: number) => void; pick: Pick; setPick: (p: Pick) => void; lib: Saved[];
  heroTime: (a: any, s: Style) => number;
  Marks: (p: { k: any; u: number; style: Style; analysis: any; vt?: number }) => any;
};
export default function SavedViewer(p: P) {
  const n = p.items.length;
  const i = Math.min(p.idx, n - 1);
  const s = p.items[i];
  const d = useVid(s.vid, p.heroTime);
  const go = (dd: number) => p.setIdx((i + dd + n) % n);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  });
  const L = LAYER_OF[s.key];
  const on = p.pick[s.key]?.uid === s.uid;
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    <>
      <div className="svv-info" key={"i" + s.uid}>
        <div className="sm-eyebrow">SAVED STYLE · {pad(i + 1)} / {pad(n)}</div>
        <div className="svv-part"><i style={{ background: L.color }} />{COMP_SHORT[s.key]}</div>
        <div className="svv-h">{s.comp.headline}</div>
        <div className="svv-src">{s.thumb && <img src={`/data/${s.vid}/${s.thumb}`} />}<div><b>{s.handle || s.source}</b><span>{s.source}</span></div></div>
        <div className="svv-specs">{s.comp.specs.slice(0, 5).map(([a, b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>
        <button className={"svv-use" + (on ? " on" : "")} onClick={() => p.setPick({ ...p.pick, [s.key]: on ? undefined : s })}>
          {on ? "✓ In your style" : "+ Use in your style"}
        </button>
        <button className="svv-rm" onClick={() => { writeLib(p.lib.filter((x) => x.uid !== s.uid)); if (i >= n - 1) p.setIdx(Math.max(0, i - 1)); }}>Remove from saved</button>
      </div>
      <button className="svv-arrow l" onClick={() => go(-1)} aria-label="Previous">‹</button>
      <div className="svv-card" style={{ ["--c" as any]: L.color, animation: `${i % 2 ? "svvA" : "svvB"} 0.45s cubic-bezier(.2,.8,.2,1)` }}>
        <Canvas className="svv-canvas" orthographic dpr={[1, 2]} resize={{ offsetSize: true }} gl={{ antialias: true, alpha: true }} camera={{ position: [0, 0, 10], zoom: 100 }}>
          <Fit />
          {d && <CardPlate key={s.uid} s={s} d={d} />}
        </Canvas>
        {d && <div className="svv-marks"><p.Marks k={s.key} u={0.5} style={d.style} analysis={d.analysis} vt={cardLive.vt} /></div>}
        {on && <div className="svv-badge">✓ IN YOUR STYLE</div>}
      </div>
      <button className="svv-arrow r" onClick={() => go(1)} aria-label="Next">›</button>
      <div className="svv-dots">{p.items.map((x, j) => <i key={x.uid} className={j === i ? "on" : ""} style={j === i ? { background: LAYER_OF[x.key].color } : undefined} onClick={() => p.setIdx(j)} />)}</div>
    </>
  );
}
