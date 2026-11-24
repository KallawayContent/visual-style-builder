// The 3D style stack of one video: the packed video (source | person | text / b-roll | motion | edges) cut into seven
// glass layers in a shader. During the scan the stack is flat; then it spreads in 3D. All layers hold one still frame;
// the hovered layer plays; a clicked layer slides to the front and faces the camera (hover then changes nothing).
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { KIND, makePlateMaterial } from "../plateMaterial";
import { LAYERS, LayerId, Style } from "./model";

export const PW = 4.5, PH = 8;
export type ViewMode = "still" | "cascade" | "live";
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

// the timing of the views (seconds after the spread starts)
export const SPREAD_D = 2.2;                       // A + C: all layers at once
export const PEEL = 0.3, PEEL_D = 0.9;             // B: one layer every 0.3 s, from the back
export const PEEL_END = PEEL * (LAYERS.length - 1) + PEEL_D;
export const PLAY_L = 2.0, TURN = PLAY_L + 0.25;   // B: each layer plays the 2 s before the hero frame, then holds on it
export const CASCADE0 = PEEL_END + 0.4;
export function cascadeLayer(xt: number): number {
  if (xt < CASCADE0) return -1;
  const u = (xt - CASCADE0) % (TURN * LAYERS.length);
  const k = Math.floor(u / TURN);
  return u - k * TURN < PLAY_L ? k : -1;
}
export function spreadOf(mode: ViewMode, xt: number, k: number) {
  if (mode === "cascade") return ease(seg(xt, k * PEEL, k * PEEL + PEEL_D));
  return ease(seg(xt, 0, SPREAD_D));
}
export const spreadDone = (mode: ViewMode) => (mode === "cascade" ? PEEL_END : SPREAD_D);

// shared with the page: where the flat plate is on screen (stage px), the video time, the camera drag, label spots
export const live = {
  rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, vt: 0, video: null as HTMLVideoElement | null,
  drag: { az: 0, el: 0, on: false, x: 0, y: 0, moved: 0 },
  labels: {} as Record<string, [number, number]>, regions: [] as { x: number; y: number; name: string; color: string }[],
  playing: null as LayerId | null,
  pinRect: null as null | { x0: number; y0: number; x1: number; y1: number },   // the pulled-out layer on screen (labels under it hide)
};

export type StageProps = {
  style: Style; analysis: any; heroT: number; mode: ViewMode;
  xt: number;                   // time since the spread started (negative during the scan)
  runId: number;                // a new run (open / replay) re-starts the live video
  focus: LayerId | null; focusAmt: number;
  active: LayerId | null;       // the pinned layer, else the hovered one
  pin: LayerId | null;          // the clicked layer: it comes out to the front
  onMiss: () => void;           // a click on empty space
  onHover: (l: LayerId | null) => void;
  onPick: (l: LayerId) => void;
  sound: boolean;
};

export function makeVideo(src: string) {
  const v = document.createElement("video");
  v.src = src; v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous"; v.preload = "auto";
  const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace;
  return { v, tex };
}
export function layoutAt(runs: any[], t: number) {
  const r = runs.find((q: any) => t >= q.t0 && t < q.t1);
  return r ? (r.layout === "split" ? 1 : r.layout === "a_full" ? 0 : 2) : 1;
}
export function capBox(caps: any[], t: number) {
  const all = caps.filter((q: any) => t >= q.t0 - 0.05 && t <= q.t1 + 0.15 && q.box[3] >= 0.025);
  const subs = all.filter((q: any) => q.kind === "caption");
  const on = subs.length ? subs : all;
  const c = (x: number) => Math.min(0.995, Math.max(0.005, x));
  return on.length ? [c(Math.min(...on.map((q: any) => q.box[0])) - 0.03), c(Math.min(...on.map((q: any) => q.box[1])) - 0.015),
    c(Math.max(...on.map((q: any) => q.box[0] + q.box[2])) + 0.03), c(Math.max(...on.map((q: any) => q.box[1] + q.box[3])) + 0.015)] : null;
}

function Plates(p: StageProps) {
  const { camera } = useThree();
  const vid = p.style.id;
  const dur = p.style.duration;
  const L = useMemo(() => makeVideo(`/data/${vid}/packed.mp4`), [vid]);
  const S = useMemo(() => makeVideo(`/data/${vid}/packed.mp4`), [vid]);
  useEffect(() => {
    L.v.loop = true; live.video = L.v;
    S.v.addEventListener("loadedmetadata", () => { S.v.currentTime = p.heroT; }, { once: true });
    S.v.load(); L.v.load();
    return () => { [L, S].forEach((x) => { x.v.pause(); x.v.removeAttribute("src"); x.v.load(); }); };
  }, [L, S]);
  useEffect(() => { if (S.v.readyState >= 1) S.v.currentTime = p.heroT; }, [p.heroT, S]);
  // a new run: the live video is at (hero time + time since the spread), so it meets the hero frame at the spread
  const xtRef = useRef(p.xt); xtRef.current = p.xt;
  const lastPlay = useRef<string | null>("none");
  useEffect(() => {
    const go = () => {
      L.v.currentTime = (((p.heroT + xtRef.current) % dur) + dur) % dur;
      L.v.play().catch(() => {});
      lastPlay.current = "none";
    };
    if (L.v.readyState >= 1) go(); else L.v.addEventListener("loadedmetadata", go, { once: true });
  }, [p.runId, L]);
  useEffect(() => { L.v.muted = !p.sound; }, [p.sound, L]);

  const pal = useMemo(() => {
    const ps = (p.style.components.grade?.data?.palette || []).map((x: any) => x.hex);
    while (ps.length < 6) ps.push(ps[ps.length - 1] || "#000000");
    return ps.slice(0, 6).map((h: string) => new THREE.Color(h));
  }, [p.style]);
  const geo = useMemo(() => new THREE.PlaneGeometry(PW, PH), []);
  const mats = useMemo(() => {
    const m: Record<string, THREE.ShaderMaterial> = {};
    LAYERS.forEach((l) => {
      m[l.id] = makePlateMaterial(L.tex, l.kind);
      m[l.id].uniforms.uAccent.value.set(l.color);
      if (l.id === "grade") m[l.id].uniforms.uPal.value = pal;
      if (l.id === "format") m[l.id].uniforms.uRegionTint.value = 1;
    });
    m.source = makePlateMaterial(L.tex, KIND.character);
    m.source.uniforms.uCtxLift.value = 1; m.source.uniforms.uGhost.value = 1;
    m.source.uniforms.uAccent.value.set("#f3eee6");
    return m;
  }, [L, pal]);
  const meshes = useRef<Record<string, THREE.Mesh>>({});
  const hoverAmt = useRef<Record<string, number>>({});
  const glow = useRef<Record<string, number>>({});
  const pull = useRef<Record<string, number>>({});
  const t0 = useRef(performance.now());
  const cam = useRef({ az: 0, el: 0 });
  const runs = p.analysis?.layout_runs || [];
  const caps = p.analysis?.captions || [];

  useFrame(() => {
    const now = (performance.now() - t0.current) / 1000;
    const xt = p.xt;
    const spreadAll = xt < 0 ? 0 : ease(seg(xt, 0, spreadDone(p.mode)));
    // which layer plays (A/B), and the live video for it: the PLAY_L seconds before the hero frame, ending ON the hero frame
    let playId: string | null = null;
    if (xt >= 0 && p.mode !== "live") {
      if (p.active) playId = p.active;
      else if (p.mode === "cascade") { const k = cascadeLayer(xt); playId = k >= 0 ? LAYERS[k].id : null; }
      if (playId !== lastPlay.current) {
        lastPlay.current = playId;
        if (playId) { L.v.currentTime = Math.max(0, p.heroT - PLAY_L); L.v.play().catch(() => {}); } else L.v.pause();
      } else if (playId && L.v.currentTime >= p.heroT - 0.02) {
        if (p.active) L.v.currentTime = Math.max(0, p.heroT - PLAY_L);   // hover: loop the clip
        else if (!L.v.paused) L.v.pause();                                // the turn: hold on the hero frame
      }
    } else if (xt >= 0 && p.mode === "live") {
      if (L.v.paused) L.v.play().catch(() => {});
      lastPlay.current = "none";
    }
    live.playing = playId as LayerId | null;
    const vt = L.v.currentTime; live.vt = vt;
    const layL = layoutAt(runs, vt), layS = layoutAt(runs, p.heroT);
    const boxL = capBox(caps, vt), boxS = capBox(caps, p.heroT);

    // camera: flat front view during the scan, then the three-quarter view + drag + a slow drift
    const dr = live.drag;
    const az = lerp(0, -32 + dr.az + Math.sin(now * 0.23) * 3.5 * (dr.on ? 0 : 1), spreadAll);
    const el = lerp(0, 9 + dr.el + Math.sin(now * 0.17) * 1.2, spreadAll);
    const c = cam.current;
    c.az = lerp(c.az, az, 0.12); c.el = lerp(c.el, el, 0.12);
    const d = lerp(19.6, 29.5, spreadAll);
    const tx = lerp(0, 3.5, spreadAll), ty = lerp(0, 0.7, spreadAll);
    const A = THREE.MathUtils.degToRad(c.az), E = THREE.MathUtils.degToRad(c.el);
    camera.position.set(tx + d * Math.sin(A) * Math.cos(E), ty + d * Math.sin(E), d * Math.cos(A) * Math.cos(E));
    camera.lookAt(tx, ty, 0);
    camera.updateMatrixWorld();
    // the front spot for a pinned layer: between the stack and the camera, a little left and up of the screen centre
    const dir = new THREE.Vector3(Math.sin(A) * Math.cos(E), Math.sin(E), Math.cos(A) * Math.cos(E));
    const right = new THREE.Vector3(Math.cos(A), 0, -Math.sin(A));
    const front = new THREE.Vector3(tx, ty, 0).addScaledVector(dir, 8).addScaledVector(right, -0.4);
    front.y += 0.15;

    const n = LAYERS.length;
    if (!p.pin) live.pinRect = null;
    LAYERS.forEach((l, k) => {
      const mesh = meshes.current[l.id]; const mat = mats[l.id]; if (!mesh) return;
      const e = xt < 0 ? 0 : spreadOf(p.mode, xt, k);
      const isA = p.active === l.id;
      const isPin = p.pin === l.id;
      const h = (hoverAmt.current[l.id] = lerp(hoverAmt.current[l.id] || 0, isA && !p.pin ? 1 : 0, 0.14));
      const pu = (pull.current[l.id] = lerp(pull.current[l.id] || 0, isPin ? 1 : 0, 0.075));
      const pe = pu * pu * (3 - 2 * pu);
      const isP = playId === l.id;
      const gl = (glow.current[l.id] = lerp(glow.current[l.id] || 0, isP && !isA ? 1 : 0, 0.1));
      const o = k - (n - 1) / 2;
      mesh.position.set(lerp(o * 1.12 * e, front.x, pe), lerp(o * 0.5 * e + h * 1.5 + gl * 0.35, front.y, pe), lerp(o * 1.7 * e + h * 0.3, front.z, pe));
      mesh.rotation.order = "YXZ";
      mesh.rotation.set(-E * pe, A * pe, 0);
      mesh.renderOrder = pu > 0.02 ? 70 : 10 + k;
      // the texture of this layer: live, or the hero still
      const useLive = xt < 0 ? true : p.mode === "live" ? l.id !== "motion" : isP;
      mat.uniforms.uTex.value = useLive ? L.tex : S.tex;
      const lay = useLive ? layL : layS, box = useLive ? boxL : boxS;
      const dim = p.pin && !isPin ? 0.18 : p.active && !isA ? 0.3 : 1;
      const isF = p.focus === l.id;
      const vis = xt >= 0 ? seg(e, 0, 0.35) : (isF ? p.focusAmt : 0);
      mat.uniforms.uOpacity.value = vis * dim;
      mat.uniforms.uFill.value = 0.08 * e + 0.86 * pe;
      mat.uniforms.uBorder.value = (0.55 + h * 0.45 + gl * 0.45) * Math.max(e, isF ? p.focusAmt * 0.6 : 0)
        * (l.id === "text" ? 1 - pe : 1);
      mat.uniforms.uFlash.value = h * (0.5 + 0.5 * Math.sin(now * 5)) * 0.6 + gl * 0.12;
      mat.uniforms.uLayout.value = lay;
      mat.uniforms.uTime.value = now;
      mat.uniforms.uRemove.value = 1; mat.uniforms.uHole.value = 0.7;
      mat.uniforms.uOutline.value = l.id === "set" ? 0.8 : 0;
      mat.uniforms.uGhost.value = Math.max(l.id === "motion" ? 0.85 : l.id === "grade" ? 1 : 0, 0.9 * pe);
      mat.uniforms.uCtxLift.value = isA ? 0.25 : 0;
      if (l.id === "text" && box) { mat.uniforms.uBoxOn.value = 1; mat.uniforms.uBox.value.set(box[0], 1 - box[3], box[2], 1 - box[1]); }
      else if (l.id === "broll" && lay === 1) { mat.uniforms.uBoxOn.value = 0.9; mat.uniforms.uBox.value.set(0.015, 0.507, 0.985, 0.99); }
      else mat.uniforms.uBoxOn.value = 0;
      mesh.updateMatrixWorld();
      const tl = new THREE.Vector3(-PW / 2, PH / 2 + 0.05, 0).applyMatrix4(mesh.matrixWorld).project(camera);
      live.labels[l.id] = [(tl.x + 1) * 960, (1 - tl.y) * 540];
      if (isPin) {
        const br = new THREE.Vector3(PW / 2, -PH / 2, 0).applyMatrix4(mesh.matrixWorld).project(camera);
        live.pinRect = pu > 0.5 ? { x0: (tl.x + 1) * 960, y0: (1 - tl.y) * 540, x1: (br.x + 1) * 960, y1: (1 - br.y) * 540 } : null;
      }
      if (l.id === "format") {
        const pt = (x: number, y: number) => { const v = new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera); return [(v.x + 1) * 960, (1 - v.y) * 540]; };
        if (lay === 1) {
          const a = pt(0, PH / 4), b = pt(0, -PH / 4);
          live.regions = [{ x: a[0], y: a[1], name: "B-ROLL", color: "#3ddc97" }, { x: b[0], y: b[1], name: "SPEAKER", color: "#ff9a4d" }];
        } else { const a = pt(0, 0); live.regions = [{ x: a[0], y: a[1], name: lay === 0 ? "SPEAKER · FULL FRAME" : "B-ROLL · FULL FRAME", color: lay === 0 ? "#ff9a4d" : "#b18cff" }]; }
      }
    });
    // the source plate: the full video in front while flat, gone when spread
    const src = meshes.current.source;
    if (src) {
      src.position.set(0, 0, 0.01); src.renderOrder = 5;
      mats.source.uniforms.uOpacity.value = 1 - seg(spreadAll, 0.0, 0.5);
      mats.source.uniforms.uBorder.value = 0.25 * (1 - spreadAll);
      src.updateMatrixWorld();
      const a = new THREE.Vector3(-PW / 2, PH / 2, 0).applyMatrix4(src.matrixWorld).project(camera);
      const b = new THREE.Vector3(PW / 2, -PH / 2, 0).applyMatrix4(src.matrixWorld).project(camera);
      live.rect = { x0: (a.x + 1) * 960, y0: (1 - a.y) * 540, x1: (b.x + 1) * 960, y1: (1 - b.y) * 540 };
    }
    const f = p.focus && meshes.current[p.focus]; if (f) f.renderOrder = 60;
  });

  const ok = () => p.xt > spreadDone(p.mode) * 0.8;
  const ev = (id: LayerId) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { if (!ok()) return; e.stopPropagation(); p.onHover(id); document.body.style.cursor = "pointer"; },
    onPointerOut: () => { p.onHover(null); document.body.style.cursor = ""; },
    onClick: (e: ThreeEvent<MouseEvent>) => { if (!ok() || live.drag.moved > 5) return; e.stopPropagation(); p.onPick(id); },
  });
  return (
    <>
      <mesh ref={(m) => { if (m) meshes.current.source = m; }} geometry={geo} material={mats.source} />
      {LAYERS.map((l) => (
        <mesh key={l.id} ref={(m) => { if (m) meshes.current[l.id] = m; }} geometry={geo} material={mats[l.id]} {...ev(l.id)} />
      ))}
    </>
  );
}

export default function Stage3D(p: StageProps) {
  return (
    <Canvas className="s3-canvas" dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 30, near: 0.1, far: 300, position: [0, 0, 19.6] }}
      onPointerMissed={() => { if (live.drag.moved <= 5) p.onMiss(); }}>
      <Plates {...p} />
    </Canvas>
  );
}
