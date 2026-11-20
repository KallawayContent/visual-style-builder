// The build screen: saved parts on the left, a live 9:16 preview in the middle, the open style and its exports on the right.
// Also the poster and part pages of the style guide export (html-to-image + jszip).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { Viz } from "./viz";
import { Canvas } from "@react-three/fiber";
import { CardPlate, Fit, cardLive, useVid } from "./SavedViewer";
import type { Style } from "./model";
import { COMP_ORDER, COMP_SHORT, CompKey, Pick, Saved, compColor, download, guideJSON, guideMarkdown, writeLib } from "./model";

export type SaveVariant = "mixer" | "shelves" | "edit";
export const SAVE_VARIANTS: { id: SaveVariant; letter: string; name: string }[] = [
  { id: "mixer", letter: "A", name: "Mixer" }, { id: "shelves", letter: "B", name: "Shelves" }, { id: "edit", letter: "C", name: "Edit the poster" },
];
const img = (s: Saved, f: string) => `/data/${s.vid}/${f}`;
const who = (s: Saved) => s.handle || s.source;

// ---------------------------------------------------------------- one picture for a saved part
export function Glyph({ s }: { s: Saved }) {
  const c = s.comp, d = c.data || {};
  switch (c.key) {
    case "layout": {
      const seam = d.seam ?? 0.5;
      return (<div className="gl gl-c"><div className="gl-phone">
        {d.main === "split" ? (<><i style={{ top: 0, height: `${seam * 100}%`, background: "rgba(61,220,151,.55)" }} /><i style={{ top: `${seam * 100}%`, bottom: 0, background: "rgba(255,154,77,.55)" }} /></>)
          : <i style={{ inset: 0, background: d.main === "a_full" ? "rgba(255,154,77,.55)" : "rgba(177,140,255,.55)" }} />}
      </div></div>);
    }
    case "pace": {
      const lens: number[] = (d.lens || []).slice(0, 34); const mx = Math.max(0.1, ...lens);
      return (<div className="gl gl-pace">{lens.map((l, i) => <i key={i} style={{ height: `${18 + (l / mx) * 82}%` }} />)}</div>);
    }
    case "person": return d.crops?.[0] ? <div className="gl"><img src={img(s, d.crops[0])} /></div> : <div className="gl gl-none" />;
    case "broll": {
      const it: any[] = d.items || []; const step = Math.max(1, Math.floor(it.length / 4));
      const four = it.filter((_, i) => i % step === 0).slice(0, 4);
      return four.length ? <div className="gl gl-4">{four.map((x) => <img key={x.file} src={img(s, x.file)} />)}</div> : <div className="gl gl-none">no B-roll</div>;
    }
    case "broll_framing": {
      const r = d.rect || [0, 0, 1, 0.5];
      return (<div className="gl gl-c"><div className="gl-phone">
        <i className="rect" style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` }} />
      </div></div>);
    }
    case "grade": {
      const g = d.aroll || d.broll || {};
      return (<div className="gl gl-grade">
        <div>{[g.shadows, g.mids, g.highlights].filter(Boolean).map((h: string, i: number) => <i key={i} style={{ background: h }} />)}</div>
        <b>{(d.palette || []).slice(0, 7).map((x: any) => <i key={x.hex} style={{ background: x.hex, flex: x.share }} />)}</b>
      </div>);
    }
    case "subtitles": case "typography": {
      const f = c.key === "typography" ? (d.crops || []).find((x: any) => x.file.includes("title_")) || d.crops?.[0] : d.crops?.[0];
      return f ? <div className="gl gl-txt"><img src={img(s, f.file)} /></div> : <div className="gl gl-none">no text</div>;
    }
    case "textcolor": {
      const m = d.main?.hex, h = d.highlight?.hex || d.title_colors?.[0]?.hex;
      return m ? <div className="gl gl-aa"><span style={{ color: m }}>Aa</span>{h && <span style={{ color: h }}>Aa</span>}</div> : <div className="gl gl-none">no text</div>;
    }
    case "motion": {
      const cv: number[] = d.curve || []; const mx = Math.max(0.01, ...cv);
      return (<div className="gl gl-motion"><svg viewBox="0 0 200 80" preserveAspectRatio="none">
        <polyline points={cv.map((v, i) => `${(i / Math.max(1, cv.length - 1)) * 200},${76 - (v / mx) * 68}`).join(" ")} fill="none" stroke="#ff4fa3" strokeWidth="2" />
      </svg></div>);
    }
    case "set": return d.image ? <div className="gl"><img src={img(s, d.image)} /></div> : <div className="gl gl-none" />;
  }
  return <div className="gl gl-none" />;
}

// a B-roll picture: real footage first (a white UI screen reads badly on a dark poster)
function brollPick(s: Saved): string | null {
  const it: any[] = s.comp.data?.items || [];
  if (!it.length) return null;
  const f = it.filter((x) => x.kind === "footage"), o = it.filter((x) => !/screen|ui/i.test(x.kind || ""));
  const L = f.length ? f : o.length ? o : it;
  return img(s, L[Math.floor(L.length / 2)].file);
}

// the biggest real picture of a part (for big cards and slides), or null
function heroImg(s: Saved): string | null {
  const d = s.comp.data || {};
  if (s.key === "person" && d.crops?.[0]) return img(s, d.crops[0]);
  if (s.key === "set" && d.image) return img(s, d.image);
  if (s.key === "broll") return brollPick(s);
  return null;
}

// ---------------------------------------------------------------- the phone built from the picked parts
function Phone({ pick, w }: { pick: Pick; w: number }) {
  const lay = pick.layout?.comp.data, br = pick.broll, pe = pick.person, sub = pick.subtitles, gr = pick.grade?.comp.data, st = pick.set;
  const seam = lay?.main === "split" ? lay.seam ?? 0.5 : lay?.main === "b_full" ? 1 : lay ? 0 : 0.5;
  const brImg = br ? brollPick(br) : null;
  const peImg = pe?.comp.data.crops?.[0] ? img(pe, pe.comp.data.crops[0]) : st?.comp.data.image ? img(st, st.comp.data.image) : null;
  const subF = sub?.comp.data.crops?.[0];
  const g = gr?.aroll || gr?.broll;
  return (
    <div className="ph" style={{ width: w, height: (w * 16) / 9, borderRadius: w * 0.08 }}>
      {seam > 0 && <div className="ph-top" style={{ height: `${seam * 100}%` }}>{brImg ? <img src={brImg} /> : <span>B-ROLL</span>}</div>}
      {seam < 1 && <div className="ph-bot" style={{ top: `${seam * 100}%` }}>{peImg ? <img src={peImg} /> : <span>SPEAKER</span>}</div>}
      {g && <div className="ph-tint" style={{ background: `linear-gradient(${g.highlights}, ${g.mids} 50%, ${g.shadows})` }} />}
      {subF && <img className="ph-sub" src={img(sub!, subF.file)} style={{ top: `${(sub!.comp.data.y ?? 0.5) * 100}%`, maxHeight: w * 0.09 }} />}
    </div>
  );
}

// ---------------------------------------------------------------- the poster (1080 x 1920): the export, and its preview
export function Poster({ name, pick, onPart, active }: { name: string; pick: Pick; onPart?: (k: CompKey) => void; active?: CompKey | null }) {
  const keys = COMP_ORDER.filter((k) => pick[k]);
  const srcs = [...new Map(keys.map((k) => [pick[k]!.vid, pick[k]!])).values()];
  const gr = pick.grade?.comp.data, tc = pick.textcolor?.comp.data, ty = pick.typography;
  const tyF = ty ? (ty.comp.data.crops || []).find((x: any) => x.file.includes("title_")) || ty.comp.data.crops?.[0] : null;
  const pace = pick.pace?.comp.data;
  const hit = (k: CompKey) => onPart ? { onClick: () => onPart(k), className: "po-hit" + (active === k ? " on" : "") } : {};
  const grid = keys.filter((k) => !["grade", "textcolor"].includes(k));
  return (
    <div className="po">
      <div className="po-glow" />
      <div className="po-eye"><i />STYLE MINER · SIGNATURE STYLE</div>
      <div className="po-title">{name}</div>
      <div className="po-from">
        <span>Built from</span>
        {srcs.map((s) => <b key={s.vid}>{s.thumb && <img src={img(s, s.thumb)} />}{who(s)}</b>)}
      </div>
      <div className="po-hero">
        <div {...hit("layout")}><Phone pick={pick} w={360} /></div>
        <div className="po-side">
          {gr?.palette && (
            <div {...hit("grade")}><div className="po-lab">COLOR GRADE</div>
              <div className="po-pal">{gr.palette.slice(0, 6).map((x: any) => <i key={x.hex} style={{ background: x.hex }}><span>{x.hex}</span></i>)}</div>
              <div className="po-small">{pick.grade!.comp.headline}</div></div>
          )}
          {(tc?.main || tyF) && (
            <div {...hit(tc?.main ? "textcolor" : "typography")}><div className="po-lab">TYPE</div>
              <div className="po-type">
                {tc?.main && <div className="po-aa"><span style={{ color: tc.main.hex }}>Aa</span>{tc.highlight && <span style={{ color: tc.highlight.hex }}>Aa</span>}</div>}
                {tyF && <img src={img(ty!, tyF.file)} />}
              </div></div>
          )}
          {pace && (
            <div {...hit("pace")}><div className="po-lab">PACE</div>
              <div className="po-num">{pick.pace!.comp.specs.find(([a]) => /median|shot/i.test(a))?.[1] || pick.pace!.comp.headline}</div></div>
          )}
        </div>
      </div>
      <div className={"po-grid n" + Math.min(4, Math.ceil(grid.length / 3))}>
        {grid.map((k) => {
          const s = pick[k]!;
          return (
            <div key={k} {...hit(k)}>
              <div className="po-card" style={{ ["--c" as any]: compColor(k) }}>
                <Glyph s={s} />
                <div className="po-ct"><i />{COMP_SHORT[k]}</div>
                <div className="po-ch">{s.comp.headline}</div>
                <div className="po-cw">{s.thumb && <img src={img(s, s.thumb)} />}{who(s)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="po-foot">{keys.length} parts · {srcs.length} creator{srcs.length === 1 ? "" : "s"} · made with Visual Style Builder</div>
    </div>
  );
}

// one TikTok slide for one part
function PartSlide({ s, i, n, name }: { s: Saved; i: number; n: number; name: string }) {
  const h = heroImg(s);
  return (
    <div className="po ps" style={{ ["--c" as any]: compColor(s.key) }}>
      <div className="po-glow" />
      <div className="po-eye"><i />{name.toUpperCase()} · {String(i).padStart(2, "0")} / {String(n).padStart(2, "0")}</div>
      <div className="ps-cat"><i />{COMP_SHORT[s.key]}</div>
      <div className="ps-who">{s.thumb && <img src={img(s, s.thumb)} />}<div><b>{who(s)}</b><span>{s.source}</span></div></div>
      <div className="ps-vis">{h ? <img src={h} /> : <div className="ps-viz"><Viz c={s.comp} vid={s.vid} size="full" /></div>}</div>
      <div className="ps-h">{s.comp.headline}</div>
      <div className="ps-specs">{s.comp.specs.slice(0, 4).map(([a, b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- export: render off screen at 1080 x 1920, then PNG
function useExporter(name: string, pick: Pick) {
  const [job, setJob] = useState<null | "poster" | "slides">(null);
  const [busy, setBusy] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-style";
  useEffect(() => {
    if (!job) return;
    (async () => {
      await new Promise((r) => setTimeout(r, 700));
      const imgs = Array.from(ref.current?.querySelectorAll("img") || []) as HTMLImageElement[];
      await Promise.all(imgs.map((x) => (x.complete ? 0 : new Promise((r) => { x.onload = x.onerror = r; }))));
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(".po") || []) as HTMLElement[];
      const shoot = (el: HTMLElement) => toPng(el, { width: 1080, height: 1920, pixelRatio: 1, cacheBust: true });
      try {
        if (job === "poster") { download(`${slug}-poster.png`, await (await fetch(await shoot(nodes[0]))).blob(), "image/png"); }
        else {
          const zip = new JSZip();
          for (let i = 0; i < nodes.length; i++) {
            setBusy(`slide ${i + 1} / ${nodes.length}`);
            const url = await shoot(nodes[i]);
            zip.file(`${String(i + 1).padStart(2, "0")}-${slug}.png`, url.split(",")[1], { base64: true });
          }
          download(`${slug}-style-guide.zip`, await zip.generateAsync({ type: "blob" }), "application/zip");
        }
      } finally { setJob(null); setBusy(""); }
    })();
  }, [job]);
  const keys = COMP_ORDER.filter((k) => pick[k]);
  const stage = job && createPortal(
    <div className="sm po-off" ref={ref}>
      <Poster name={name} pick={pick} />
      {job === "slides" && keys.map((k, i) => <PartSlide key={k} s={pick[k]!} i={i + 1} n={keys.length} name={name} />)}
    </div>, document.body);
  return { run: setJob, busy: job ? busy || "rendering" : "", stage };
}

// ---------------------------------------------------------------- the export column (A + B: under the poster preview; C: in the tray)
function ExportBar({ name, setName, pick, noName }: { name: string; setName: (s: string) => void; pick: Pick; noName?: boolean }) {
  const ex = useExporter(name, pick);
  const [copied, setCopied] = useState(false);
  const any = COMP_ORDER.some((k) => pick[k]);
  return (
    <div className="cx">
      {!noName && <input className="cx-name" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />}
      <div className="cx-row">
        <button className="cx-b main" disabled={!any || !!ex.busy} onClick={() => ex.run("slides")}>{ex.busy ? `Exporting · ${ex.busy}` : "Export style guide"}</button>
      </div>
      <div className="cx-row small">
        <button className="cx-b" disabled={!any} onClick={async () => { const md = guideMarkdown(name, pick); try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { download("style.md", md); } }}>{copied ? "Copied ✓" : "Copy for ChatGPT"}</button>
        <button className="cx-b" disabled={!any} onClick={() => download("style.json", JSON.stringify(guideJSON(name, pick), null, 2), "application/json")}>JSON</button>
      </div>
      {ex.stage}
    </div>
  );
}

export function PosterPreview({ name, pick, h, onPart, active }: { name: string; pick: Pick; h: number; onPart?: (k: CompKey) => void; active?: CompKey | null }) {
  const sc = h / 1920;
  return (
    <div className="pp" style={{ width: 1080 * sc, height: h }}>
      <div style={{ transform: `scale(${sc})`, transformOrigin: "0 0" }}><Poster name={name} pick={pick} onPart={onPart} active={active} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- the preview: the real thing, 9:16, playing
type Fx = { heroTime: (a: any, s: Style) => number; Marks: (p: { k: any; u: number; style: Style; analysis: any; vt?: number }) => any };
export function PartPreview({ s, h, on, toggle, fx }: { s: Saved; h: number; on: boolean; toggle: () => void; fx: Fx }) {
  const d = useVid(s.vid, fx.heroTime);
  const w = (h * 9) / 16;
  return (
    <div className="pv" style={{ width: w, ["--c" as any]: compColor(s.key) }}>
      <div className="pv-card" style={{ width: w, height: h }} key={s.uid}>
        <Canvas className="svv-canvas" orthographic dpr={[1, 2]} resize={{ offsetSize: true }} gl={{ antialias: true, alpha: true }} camera={{ position: [0, 0, 10], zoom: 100 }}>
          <Fit />
          {d && <CardPlate key={s.uid} s={s} d={d} />}
        </Canvas>
        {d && <div className="svv-marks"><fx.Marks k={s.key} u={0.5} style={d.style} analysis={d.analysis} vt={cardLive.vt} /></div>}
        <div className="pv-top"><i />{COMP_SHORT[s.key]}<span>{s.thumb && <img src={img(s, s.thumb)} />}{who(s)}</span></div>
        {!d && <div className="pv-load">Loading the video…</div>}
      </div>
      <div className="pv-h">{s.comp.headline}</div>
      <button className={"pv-use" + (on ? " on" : "")} onClick={toggle}>{on ? "✓ In your style" : "+ Use this"}</button>
    </div>
  );
}

// the right column of A + B: the preview of what you clicked, or the poster
function RightCol({ focus, setFocus, p, fx }: { focus: Saved | null; setFocus: (s: Saved | null) => void; p: V; fx: Fx }) {
  const on = !!focus && p.pick[focus.key]?.uid === focus.uid;
  return (
    <div className="cb2-right">
      <div className="pv-tabs">
        <button className={focus ? "on" : ""} disabled={!focus} onClick={() => focus && setFocus(focus)}>Preview</button>
        <button className={!focus ? "on" : ""} onClick={() => setFocus(null)}>Poster</button>
      </div>
      {focus ? <PartPreview s={focus} h={640} on={on} toggle={() => p.use(focus.key, on ? undefined : focus)} fx={fx} />
        : <PosterPreview name={p.name} pick={p.pick} h={640} />}
      <ExportBar name={p.name} setName={p.setName} pick={p.pick} />
    </div>
  );
}

// ---------------------------------------------------------------- the three ways
type P = { lib: Saved[]; pick: Pick; setPick: (p: Pick) => void; variant: SaveVariant; setVariant: (v: SaveVariant) => void; back: () => void } & Fx;

export default function Combine(p: P) {
  const [name, setNameRaw] = useState(() => { try { return localStorage.getItem("styleminer.name") || "My signature style"; } catch { return "My signature style"; } });
  const setName = (s: string) => { setNameRaw(s); try { localStorage.setItem("styleminer.name", s); } catch {} };
  const cats = COMP_ORDER.filter((k) => p.lib.some((s) => s.key === k));
  const opts = (k: CompKey) => p.lib.filter((s) => s.key === k).sort((a, b) => a.at - b.at);
  const use = (k: CompKey, s: Saved | undefined) => p.setPick({ ...p.pick, [k]: s });
  const remove = (s: Saved) => { writeLib(p.lib.filter((x) => x.uid !== s.uid)); if (p.pick[s.key]?.uid === s.uid) use(s.key, undefined); };
  return (
    <div className="cb2">
      <div className="cb2-head">
        <button className="pn-back" onClick={p.back}><i>←</i>Layers</button>
        <div className="sm-eyebrow">SAVED STYLES · {p.lib.length} SAVED FROM {new Set(p.lib.map((s) => s.vid)).size} VIDEOS</div>
        <div className="cb2-t">Combine your style</div>
      </div>
      {!p.lib.length && <div className="cb2-empty">Nothing saved yet. Click a layer, then <b>+ Save</b>. Saved parts from every video you mine collect here.</div>}
      {p.lib.length > 0 && p.variant === "mixer" && <Mixer {...p} cats={cats} opts={opts} use={use} name={name} setName={setName} />}
      {p.lib.length > 0 && p.variant === "shelves" && <Shelves {...p} cats={cats} opts={opts} use={use} remove={remove} name={name} setName={setName} />}
      {p.lib.length > 0 && p.variant === "edit" && <EditPoster {...p} cats={cats} opts={opts} use={use} remove={remove} name={name} setName={setName} />}
      <div className="lv-views cb2-switch">
        <span>COMBINE VIEW</span>
        {SAVE_VARIANTS.map((v) => <button key={v.id} className={p.variant === v.id ? "on" : ""} onClick={() => p.setVariant(v.id)}><b>{v.letter}</b>{v.name}</button>)}
      </div>
    </div>
  );
}

type V = P & { cats: CompKey[]; opts: (k: CompKey) => Saved[]; use: (k: CompKey, s: Saved | undefined) => void; remove?: (s: Saved) => void; name: string; setName: (s: string) => void };

// A: one row per category, flip through the saved ones
function Mixer(p: V) {
  const [fk, setFk] = useState<CompKey | null>(null);
  const focus = fk ? p.pick[fk] || p.opts(fk)[0] || null : null;
  return (
    <>
      <div className="mx">
        <div className="mx-note">Click a part to see it. Flip with ‹ › through what you saved. "Poster" on the right is what you export.</div>
        {p.cats.map((k) => {
          const o = p.opts(k); const cur = p.pick[k]; const i = cur ? o.findIndex((s) => s.uid === cur.uid) : -1;
          const go = (d: number) => { p.use(k, o[(((i < 0 ? 0 : i) + d) % o.length + o.length) % o.length]); setFk(k); };
          return (
            <div key={k} className={"mx-row" + (cur ? "" : " off") + (fk === k ? " foc" : "")} style={{ ["--c" as any]: compColor(k) }} onClick={() => setFk(k)}>
              <div className="mx-cat"><i />{COMP_SHORT[k]}</div>
              <button className="mx-a" disabled={o.length < 2} onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
              <div className="mx-cur" key={cur?.uid || "none"}>
                {cur ? (<><Glyph s={cur} /><div><b>{cur.comp.headline}</b><span>{cur.thumb && <img src={img(cur, cur.thumb)} />}{who(cur)}</span></div></>) : <em>Not in your style</em>}
              </div>
              <button className="mx-a" disabled={o.length < 2} onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
              <div className="mx-n">{o.map((s) => <i key={s.uid} className={s.uid === cur?.uid ? "on" : ""} />)}</div>
              <button className={"mx-tg" + (cur ? " on" : "")} onClick={(e) => { e.stopPropagation(); p.use(k, cur ? undefined : o[0]); }} title={cur ? "Leave out" : "Use"}><i /></button>
            </div>
          );
        })}
      </div>
      <RightCol focus={focus} setFocus={(s) => setFk(s ? s.key : null)} p={p} fx={p} />
    </>
  );
}

// B: category tabs, big 9:16 cards of the saved ones
function Shelves(p: V) {
  const [cat, setCat] = useState<CompKey>(p.cats[0]);
  const [focus, setFocus] = useState<Saved | null>(null);
  const k = p.cats.includes(cat) ? cat : p.cats[0];
  const o = p.opts(k);
  return (
    <>
      <div className="sh">
        <div className="sh-tabs">{p.cats.map((c) => (
          <button key={c} className={c === k ? "on" : ""} style={{ ["--c" as any]: compColor(c) }} onClick={() => setCat(c)}>
            <i />{COMP_SHORT[c]}<b>{p.opts(c).length}</b>{p.pick[c] && <em>✓</em>}
          </button>))}
        </div>
        <div className="sh-cards" key={k}>
          {o.map((s) => {
            const on = p.pick[k]?.uid === s.uid; const h = heroImg(s);
            return (
              <div key={s.uid} className={"sh-card" + (on ? " on" : "") + (focus?.uid === s.uid ? " foc" : "")} style={{ ["--c" as any]: compColor(k) }} onClick={() => setFocus(s)}>
                <div className="sh-bg" style={{ backgroundImage: `url(${img(s, s.thumb || "")})` }} />
                <div className="sh-vis">{h ? <img src={h} /> : <Glyph s={s} />}</div>
                <div className="sh-txt"><b>{s.comp.headline}</b><span>{s.thumb && <img src={img(s, s.thumb)} />}{who(s)}</span></div>
                <button className="sh-use" onClick={(e) => { e.stopPropagation(); p.use(k, on ? undefined : s); }}>{on ? "✓ In your style" : "+ Use this"}</button>
                <button className="sh-rm" onClick={(e) => { e.stopPropagation(); p.remove!(s); }} title="Remove from saved">×</button>
              </div>
            );
          })}
        </div>
      </div>
      <RightCol focus={focus && p.lib.some((x) => x.uid === focus.uid) ? focus : null} setFocus={setFocus} p={p} fx={p} />
    </>
  );
}

// C: the poster is the editor
function EditPoster(p: V) {
  const [act, setActRaw] = useState<CompKey | null>(null);
  const [focus, setFocus] = useState<Saved | null>(null);
  const setAct = (k: CompKey | null) => { setActRaw(k); setFocus(k ? p.pick[k] || p.opts(k)[0] || null : null); };
  const o = act ? p.opts(act) : [];
  const missing = p.cats.filter((k) => !p.pick[k]);
  return (
    <>
      <div className="ed-left">
        {focus && p.lib.some((x) => x.uid === focus.uid) ? (
          <PartPreview s={focus} h={630} on={p.pick[focus.key]?.uid === focus.uid} toggle={() => p.use(focus.key, p.pick[focus.key]?.uid === focus.uid ? undefined : focus)} fx={p} />
        ) : <div className="mx-note">Click any part of the poster to see it and swap it for another one you saved.</div>}
        {!focus && missing.length > 0 && <div className="ed-miss"><div className="po-lab">NOT ON THE POSTER</div>{missing.map((k) => <button key={k} onClick={() => setAct(k)} style={{ ["--c" as any]: compColor(k) }}><i />{COMP_SHORT[k]}</button>)}</div>}
      </div>
      <div className="ed-poster"><PosterPreview name={p.name} pick={p.pick} h={860} onPart={(k) => setAct(k)} active={act} /></div>
      <div className="ed-tray">
        {act ? (
          <div className="ed-sw" key={act}>
            <div className="ed-st" style={{ ["--c" as any]: compColor(act) }}><i />{COMP_SHORT[act]}<button className="pn-x" onClick={() => setAct(null)}>×</button></div>
            <div className="ed-list">
              {o.map((s) => {
                const on = p.pick[act]?.uid === s.uid;
                return (
                  <div key={s.uid} className={"ed-it" + (on ? " on" : "") + (focus?.uid === s.uid ? " foc" : "")} onClick={() => { p.use(act, s); setFocus(s); }}>
                    <Glyph s={s} />
                    <div><b>{s.comp.headline}</b><span>{s.thumb && <img src={img(s, s.thumb)} />}{who(s)}</span></div>
                    {on && <em>✓</em>}
                  </div>
                );
              })}
              {!o.length && <div className="mx-note">Nothing saved for this part yet.</div>}
            </div>
            {p.pick[act] && <button className="ed-out" onClick={() => p.use(act, undefined)}>Take off the poster</button>}
          </div>
        ) : <div className="ed-hint">Pick a part on the poster.</div>}
        <ExportBar name={p.name} setName={p.setName} pick={p.pick} />
      </div>
    </>
  );
}


type Build = { id: string; name: string; uids: Partial<Record<CompKey, string>> };
type Builds = { active: string; styles: Build[] };
const BKEY = "styleminer.builds.v1";
const newId = () => Math.random().toString(36).slice(2, 9);
function readBuilds(): Builds {
  try { const x = JSON.parse(localStorage.getItem(BKEY) || ""); if (x?.styles?.length) return x; } catch {}
  let first: Build = { id: newId(), name: "Style 1", uids: {} };
  try { const old = JSON.parse(localStorage.getItem("styleminer.build.v1") || ""); if (old?.uids) first = { ...first, name: old.name || "Style 1", uids: old.uids }; } catch {}
  return { active: first.id, styles: [first] };
}

export function Builder2({ lib, close, fx }: { lib: Saved[]; close: () => void; fx: Fx }) {
  const [all, setAllRaw] = useState<Builds>(readBuilds);
  const setAll = (x: Builds) => { setAllRaw(x); try { localStorage.setItem(BKEY, JSON.stringify(x)); } catch {} };
  const b = all.styles.find((x) => x.id === all.active) || all.styles[0];
  const put = (x: Build, active = all.active) => setAll({ active, styles: all.styles.map((y) => (y.id === x.id ? x : y)) });
  const save = (x: Build) => put(x);
  const [menu, setMenu] = useState(false);
  const nextName = () => { let n = all.styles.length + 1; while (all.styles.some((x) => x.name === `Style ${n}`)) n++; return `Style ${n}`; };
  const newStyle = (s?: Saved) => {
    const st: Build = { id: newId(), name: nextName(), uids: s ? { [s.key]: s.uid } : {} };
    setAll({ active: st.id, styles: [...all.styles, st] });
  };
  const addTo = (id: string, s: Saved) => { const t = all.styles.find((x) => x.id === id)!; setAll({ active: id, styles: all.styles.map((y) => (y.id === id ? { ...t, uids: { ...t.uids, [s.key]: s.uid } } : y)) }); };
  const removeStyle = (id: string) => {
    if (all.styles.length < 2) return;
    const rest = all.styles.filter((x) => x.id !== id);
    setAll({ active: all.active === id ? rest[0].id : all.active, styles: rest });
  };
  const badges = (s: Saved) => all.styles.map((x, i) => [x, i] as const).filter(([x]) => x.uids[s.key] === s.uid);
  const pick: Pick = {};
  COMP_ORDER.forEach((k) => { const s = lib.find((x) => x.uid === b.uids[k]); if (s) pick[k] = s; });
  const [sel, setSel] = useState<Saved | null>(null);
  const [showPoster, setShowPoster] = useState(false);
  const groups = COMP_ORDER.map((k) => [k, lib.filter((s) => s.key === k)] as const).filter(([, v]) => v.length);
  const added = COMP_ORDER.filter((k) => pick[k]);
  const inStyle = (s: Saved) => b.uids[s.key] === s.uid;
  const add = (s: Saved) => save({ ...b, uids: { ...b.uids, [s.key]: s.uid } });
  const drop = (k: CompKey) => { const u = { ...b.uids }; delete u[k]; save({ ...b, uids: u }); };
  const cur = sel && lib.some((x) => x.uid === sel.uid) ? sel : null;
  // UNSAVE: the part leaves the saved list AND every style that holds it;
  // an Undo notice for 6 s puts both back
  const [undo, setUndo] = useState<null | { s: Saved; at: number; styles: Build[] }>(null);
  const unsave = (s: Saved) => {
    const at = lib.findIndex((x) => x.uid === s.uid);
    setUndo({ s, at, styles: all.styles });
    setAll({ ...all, styles: all.styles.map((x) => { if (x.uids[s.key] !== s.uid) return x; const u = { ...x.uids }; delete u[s.key]; return { ...x, uids: u }; }) });
    writeLib(lib.filter((x) => x.uid !== s.uid));
    if (cur?.uid === s.uid) setSel(null);
  };
  const restore = () => {
    if (!undo) return;
    const l = lib.filter((x) => x.uid !== undo.s.uid); l.splice(Math.max(0, Math.min(undo.at, l.length)), 0, undo.s);
    writeLib(l);
    const k = undo.s.key, u = undo.s.uid;   // put it back into the styles that held it (styles made since stay as they are)
    setAll({ ...all, styles: all.styles.map((x) => (undo.styles.find((y) => y.id === x.id)?.uids[k] === u ? { ...x, uids: { ...x.uids, [k]: u } } : x)) });
    setSel(undo.s); setUndo(null);
  };
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(t); }, [undo]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);
  return (
    <div className="sm b2">
      <div className="b2-top">
        <button className="b2-home" onClick={close} title="Back to the home page (Esc)"><i>←</i>Home</button>
        <div className="b2-tabs">
          {all.styles.map((x) => (
            <div key={x.id} className={"b2-tab" + (x.id === b.id ? " on" : "")} onClick={() => setAll({ ...all, active: x.id })}>
              {x.id === b.id ? <input value={x.name} onChange={(e) => save({ ...b, name: e.target.value })} spellCheck={false} style={{ width: Math.max(4, x.name.length) + "ch" }} /> : <span>{x.name}</span>}
              <em>{Object.keys(x.uids).length}</em>
              {all.styles.length > 1 && <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${x.name}?`)) removeStyle(x.id); }} title="Delete this style">×</button>}
            </div>
          ))}
          <button className="b2-new" onClick={() => newStyle()}>+ New style</button>
        </div>
        <span className="b2-sub">Click a saved part to see it. + adds it to {b.name || "the open style"}.</span>
        <button className="pn-x" onClick={close} title="Close and go home (Esc)">×</button>
      </div>
      <div className="b2-body">
        <aside className="b2-left">
          <div className="b2-lt">SAVED · {lib.length}</div>
          {!lib.length && <div className="dw-empty">Nothing saved yet. Click a layer of a video, then + Save.</div>}
          {groups.map(([k, items]) => (
            <div key={k} className="dw-g">
              <div className="dw-gt" style={{ color: compColor(k) }}>{COMP_NUM_OF(k)} {COMP_SHORT[k].toUpperCase()} <em>{items.length}</em></div>
              {items.map((s) => (
                <div key={s.uid} className={"dw-it b2-it" + (cur?.uid === s.uid ? " sel" : "")} onClick={() => { setSel(s); setShowPoster(false); }}>
                  {s.thumb && <img src={img(s, s.thumb)} />}
                  <div><b>{s.comp.headline}</b><span>{who(s)}</span></div>
                  <span className="b2-bd">{badges(s).map(([x, i]) => <i key={x.id} className={x.id === b.id ? "on" : ""} title={x.name}>{i + 1}</i>)}</span>
                  {inStyle(s) ? <em className="b2-in">✓</em> : <button className="b2-plus" onClick={(e) => { e.stopPropagation(); add(s); setSel(s); setShowPoster(false); }} title={`Add to ${b.name}`}>+</button>}
                  <button className="b2-unsave" onClick={(e) => { e.stopPropagation(); unsave(s); }} title="Remove from saved">×</button>
                </div>
              ))}
            </div>
          ))}
        </aside>
        <main className="b2-mid">
          {showPoster ? <PosterPreview name={b.name || "Style 1"} pick={pick} h={Math.min(760, window.innerHeight - 190)} />
            : cur ? (
              <div className="b2-show" key={cur.uid}>
                <PartPreview s={cur} h={Math.min(720, window.innerHeight - 230)} on={inStyle(cur)} toggle={() => (inStyle(cur) ? drop(cur.key) : add(cur))} fx={fx} />
                <div className="b2-act">
                  <div className="b2-cat" style={{ color: compColor(cur.key) }}>{COMP_SHORT[cur.key]}</div>
                  <div className="b2-h">{cur.comp.headline}</div>
                  <div className="b2-src">{cur.thumb && <img src={img(cur, cur.thumb)} />}{who(cur)} · {cur.source}</div>
                  <div className="svv-specs">{cur.comp.specs.slice(0, 5).map(([a, x]) => <div key={a}><span>{a}</span><b>{x}</b></div>)}</div>
                  <div className="b2-addrow">
                    <button className={"b2-add" + (inStyle(cur) ? " on" : "")} onClick={() => (inStyle(cur) ? drop(cur.key) : add(cur))}>
                      <i>{inStyle(cur) ? "✓" : "+"}</i>{inStyle(cur) ? `In ${b.name || "your style"}` : `Add to ${b.name || "your style"}`}
                    </button>
                    <button className={"b2-more" + (menu ? " on" : "")} onClick={() => setMenu((m) => !m)} title="Add to another style">▾</button>
                    {menu && (
                      <div className="b2-menu" onMouseLeave={() => setMenu(false)}>
                        {all.styles.filter((x) => x.id !== b.id).map((x) => (
                          <button key={x.id} onClick={() => { addTo(x.id, cur); setMenu(false); }}>
                            {x.uids[cur.key] === cur.uid ? "✓ In" : "+ Add to"} {x.name}{x.uids[cur.key] && x.uids[cur.key] !== cur.uid ? <em> (replaces its {COMP_SHORT[cur.key].toLowerCase()})</em> : null}
                          </button>
                        ))}
                        <button onClick={() => { newStyle(cur); setMenu(false); }}>+ Add to a new style ({nextName()})</button>
                      </div>
                    )}
                  </div>
                  {!inStyle(cur) && pick[cur.key] && <div className="b2-note">Replaces the {COMP_SHORT[cur.key].toLowerCase()} from {who(pick[cur.key]!)}.</div>}
                  <button className="b2-rm" onClick={() => unsave(cur)}>Remove from saved{badges(cur).length ? ` (also leaves ${badges(cur).map(([x]) => x.name).join(", ")})` : ""}</button>
                </div>
              </div>
            ) : <div className="b2-empty">Pick a saved part on the left.</div>}
        </main>
        <aside className="b2-right">
          <div className="b2-rt"><b>{b.name || "Style 1"}</b><span>{added.length} part{added.length === 1 ? "" : "s"}</span></div>
          <div className="b2-list">
            {!added.length && <div className="b2-none">Nothing added yet. Press + on a saved part.</div>}
            {added.map((k) => {
              const s = pick[k]!;
              return (
                <div key={k} className={"b2-row" + (cur?.uid === s.uid && !showPoster ? " sel" : "")} onClick={() => { setSel(s); setShowPoster(false); }}>
                  <Glyph s={s} />
                  <div><span style={{ color: compColor(k) }}>{COMP_SHORT[k]}</span><b>{s.comp.headline}</b><em>{who(s)}</em></div>
                  <button onClick={(e) => { e.stopPropagation(); drop(k); }} title="Remove">×</button>
                </div>
              );
            })}
          </div>
          <button className="b2-poster" disabled={!added.length} onClick={() => setShowPoster((x) => !x)}>{showPoster ? "Back to the part" : "See the poster"}</button>
          <ExportBar name={b.name || "Style 1"} setName={(n) => save({ ...b, name: n })} pick={pick} noName />
        </aside>
      </div>
      {undo && <div className="b2-undo">Removed {COMP_SHORT[undo.s.key].toLowerCase()} · {who(undo.s)}<button onClick={restore}>Undo</button></div>}
    </div>
  );
}
const COMP_NUM_OF = (k: CompKey) => String(COMP_ORDER.indexOf(k) + 1).padStart(2, "0");
