// One visual for each style component, drawn from the measured data. size "mini" = the hover panel, "full" = the guide.
import React from "react";
import type { Comp } from "./model";
import { compColor } from "./model";

type P = { c: Comp; vid: string; size?: "mini" | "full" };
const url = (vid: string, f: string) => `/data/${vid}/${f}`;
const pctN = (x: number) => `${Math.round(x * 100)}%`;
const LAYC: Record<string, string> = { split: "#3ddc97", a_full: "#ff9a4d", b_full: "#b18cff" };

function Frame({ w, children, img }: { w: number; children?: React.ReactNode; img?: string }) {
  return (
    <div className="vz-frame" style={{ width: w, height: (w * 16) / 9 }}>
      {img && <img src={img} />}
      {children}
    </div>
  );
}

export function Viz({ c, vid, size = "mini" }: P) {
  const d = c.data || {};
  const full = size === "full";
  const col = compColor(c.key);
  switch (c.key) {
    case "layout": {
      const seam = d.seam ?? 0.5;
      const dur = d.runs?.length ? d.runs[d.runs.length - 1][2] : 1;
      return (
        <div className="vz-row">
          <Frame w={full ? 120 : 76}>
            {d.main === "split" ? (<>
              <div className="vz-reg" style={{ top: 0, height: pctN(seam), background: "rgba(61,220,151,.22)", borderColor: "#3ddc97" }}><span>B-ROLL</span></div>
              <div className="vz-reg" style={{ top: pctN(seam), bottom: 0, background: "rgba(255,154,77,.18)", borderColor: "#ff9a4d" }}><span>SPEAKER</span></div>
            </>) : <div className="vz-reg" style={{ inset: 0, background: d.main === "a_full" ? "rgba(255,154,77,.18)" : "rgba(177,140,255,.2)", borderColor: d.main === "a_full" ? "#ff9a4d" : "#b18cff" }}><span>{d.main === "a_full" ? "SPEAKER" : "B-ROLL"}</span></div>}
          </Frame>
          <div className="vz-col">
            <div className="vz-bar">
              {(d.runs || []).map((r: any, i: number) => <i key={i} style={{ left: `${(r[1] / dur) * 100}%`, width: `${((r[2] - r[1]) / dur) * 100}%`, background: LAYC[r[0]] }} />)}
            </div>
            <div className="vz-legend">
              {(["split", "a_full", "b_full"] as const).map((k) => <span key={k}><i style={{ background: LAYC[k] }} />{{ split: "split", a_full: "speaker", b_full: "B-roll" }[k]} {pctN(d.share?.[k] || 0)}</span>)}
            </div>
          </div>
        </div>
      );
    }
    case "pace": {
      const lens: number[] = d.lens || []; const tot = lens.reduce((a, b) => a + b, 0) || 1;
      const hist: number[] = d.hist || []; const hm = Math.max(1, ...hist);
      return (
        <div className="vz-col">
          <div className="vz-shots">{lens.map((l, i) => <i key={i} style={{ width: `${(l / tot) * 100}%`, background: i % 2 ? col : "rgba(255,79,163,.45)" }} />)}</div>
          <div className="vz-hist" style={{ height: full ? 90 : 54 }}>
            {hist.map((h, i) => <div key={i}><i style={{ height: `${(h / hm) * 100}%`, background: col }} /><span>{d.hist_labels?.[i]}</span></div>)}
          </div>
          <div className="vz-cap">SHOT LENGTHS (S) · {lens.length} SHOTS</div>
        </div>
      );
    }
    case "person": {
      const w = full ? 130 : 82;
      return (
        <div className="vz-row">
          <Frame w={w}>
            {d.heat && <img className="vz-heat" src={url(vid, d.heat)} style={d.area === "bottom" ? { top: "50%", height: "50%" } : undefined} />}
            {d.eye_y != null && <div className="vz-line" style={{ top: `${(d.area === "bottom" ? 50 : 0) + d.eye_y * (d.area === "bottom" ? 50 : 100)}%`, borderColor: col }}><span style={{ color: col }}>EYES</span></div>}
            {d.cx != null && <div className="vz-vline" style={{ left: pctN(d.cx) }} />}
          </Frame>
          <div className="vz-col">
            {full && <div className="vz-strip">{(d.crops || []).slice(0, 4).map((f: string) => <img key={f} src={url(vid, f)} />)}</div>}
            {!full && <div className="vz-strip small">{(d.crops || []).slice(0, 3).map((f: string) => <img key={f} src={url(vid, f)} />)}</div>}
            {d.wardrobe?.length > 0 && <div className="vz-sw">{d.wardrobe.slice(0, 3).map((x: any) => <i key={x.hex} style={{ background: x.hex }} title={x.hex} />)}<span>WARDROBE</span></div>}
          </div>
        </div>
      );
    }
    case "broll": {
      const items: any[] = d.items || [];
      const n = full ? 12 : 6;
      const step = Math.max(1, Math.floor(items.length / n));
      const pick = items.filter((_, i) => i % step === 0).slice(0, n);
      const kinds = Object.entries(d.kinds || {}) as [string, number][];
      const tot = kinds.reduce((a, [, v]) => a + v, 0) || 1;
      const KC = ["#3ddc97", "#5b8cff", "#ff9a4d", "#b18cff"];
      if (!items.length) return <div className="vz-empty">No B-roll in this video</div>;
      return (
        <div className="vz-col">
          <div className={"vz-grid" + (full ? " full" : "")}>{pick.map((x) => <div key={x.file} className="vz-cell"><img src={url(vid, x.file)} /><span>{x.kind}</span></div>)}</div>
          <div className="vz-stack">{kinds.map(([k, v], i) => <i key={k} style={{ width: `${(v / tot) * 100}%`, background: KC[i % 4] }} title={k} />)}</div>
          <div className="vz-legend">{kinds.map(([k, v], i) => <span key={k}><i style={{ background: KC[i % 4] }} />{k} {pctN(v / tot)}</span>)}</div>
        </div>
      );
    }
    case "broll_framing": {
      const r = d.rect || [0, 0, 1, 0.5];
      const moves = Object.entries(d.moves || {}) as [string, number][];
      const tot = moves.reduce((a, [, v]) => a + v, 0) || 1;
      if (!d.count) return <div className="vz-empty">No B-roll in this video</div>;
      return (
        <div className="vz-row">
          <Frame w={full ? 120 : 76}>
            <div className="vz-reg glow" style={{ left: pctN(r[0]), top: pctN(r[1]), width: pctN(r[2] - r[0]), height: pctN(r[3] - r[1]), borderColor: col, background: "rgba(61,220,151,.2)" }}><span>B-ROLL</span></div>
          </Frame>
          <div className="vz-col">
            {moves.map(([k, v]) => <div key={k} className="vz-meter"><span>{k}</span><b><i style={{ width: pctN(v / tot), background: col }} /></b><em>{pctN(v / tot)}</em></div>)}
            <div className="vz-meter"><span>letterboxed</span><b><i style={{ width: pctN((d.letterbox || 0) / d.count), background: "#8f8a83" }} /></b><em>{pctN((d.letterbox || 0) / d.count)}</em></div>
          </div>
        </div>
      );
    }
    case "grade": {
      const g = d.aroll || d.broll; if (!g) return null;
      const W = full ? 120 : 84, R = W / 2 - 6;
      const dot = (t: number[], c: string, lab: string) => {
        const k = R / 22; const x = W / 2 + Math.max(-R, Math.min(R, t[0] * k)), y = W / 2 - Math.max(-R, Math.min(R, t[1] * k));
        return <g><circle cx={x} cy={y} r={full ? 7 : 5} fill={c} stroke="#fff" strokeWidth="1.5" /><text x={x + 9} y={y + 4} fill="#f3eee6" fontSize="9" fontFamily="JetBrains Mono">{lab}</text></g>;
      };
      const hist: number[] = g.hist || [];
      return (
        <div className="vz-col">
          <div className="vz-row">
            <div className="vz-tones">{[["SHADOWS", g.shadows], ["MIDS", g.mids], ["HIGHLIGHTS", g.highlights]].map(([l, h]) => <div key={l}><i style={{ background: h }} /><span>{l}</span><em>{h}</em></div>)}</div>
            <svg width={W} height={W} className="vz-wheel">
              <defs><radialGradient id={"wh" + W}><stop offset="0" stopColor="#888" /><stop offset="1" stopColor="#888" stopOpacity="0" /></radialGradient></defs>
              <circle cx={W / 2} cy={W / 2} r={R} fill="none" stroke="rgba(243,238,230,.25)" />
              {[["#ff4f6d", 0], ["#ffd84d", 90], ["#3ddc97", 180], ["#5b8cff", 270]].map(([c, a]) => { const r = (Number(a) * Math.PI) / 180; return <circle key={String(a)} cx={W / 2 + Math.cos(r) * R} cy={W / 2 - Math.sin(r) * R} r="3" fill={String(c)} />; })}
              <line x1={W / 2 - R} x2={W / 2 + R} y1={W / 2} y2={W / 2} stroke="rgba(243,238,230,.12)" /><line y1={W / 2 - R} y2={W / 2 + R} x1={W / 2} x2={W / 2} stroke="rgba(243,238,230,.12)" />
              {dot(g.shadow_tint, g.shadows, "S")}{dot(g.highlight_tint, g.highlights, "H")}
            </svg>
          </div>
          <svg className="vz-histo" viewBox="0 0 320 60" preserveAspectRatio="none" style={{ height: full ? 64 : 40 }}>
            <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stopColor="#000" /><stop offset="1" stopColor="#fff" /></linearGradient></defs>
            <polygon points={`0,60 ${hist.map((h, i) => `${(i / (hist.length - 1)) * 320},${60 - h * 56}`).join(" ")} 320,60`} fill={col} fillOpacity="0.35" stroke={col} strokeWidth="1.5" />
            <rect x="0" y="58" width="320" height="2" fill="url(#lg)" />
          </svg>
          <div className="vz-pal">{(d.palette || []).slice(0, 8).map((x: any) => <i key={x.hex} style={{ background: x.hex, flex: x.share }} title={x.hex} />)}</div>
        </div>
      );
    }
    case "subtitles": {
      const crops: any[] = d.crops || [];
      if (!crops.length) return <div className="vz-empty">No subtitles found</div>;
      return (
        <div className="vz-row">
          <Frame w={full ? 110 : 70}>
            {(d.ys || []).slice(0, 220).map((y: number, i: number) => <i key={i} className="vz-dot" style={{ top: pctN(y), left: pctN(d.xs[i]), background: col }} />)}
            <div className="vz-line" style={{ top: pctN(d.y), borderColor: col }} />
          </Frame>
          <div className="vz-col">
            <div className={"vz-crops" + (full ? " full" : "")}>{crops.slice(0, full ? 6 : 3).map((x) => <img key={x.file} src={url(vid, x.file)} title={x.text} />)}</div>
          </div>
        </div>
      );
    }
    case "typography": {
      const cp = d.caption, tt = d.title;
      const crops: any[] = d.crops || [];
      const mx = Math.max(cp?.size_px || 0, tt?.size_px || 0, 1);
      return (
        <div className="vz-col">
          <div className={"vz-spec" + (full ? " full" : "")}>{crops.slice(0, full ? 6 : 3).map((x) => <img key={x.file} src={url(vid, x.file)} />)}</div>
          <div className="vz-scale">
            {cp && <div><i style={{ height: (cp.size_px / mx) * (full ? 60 : 36), background: col }} /><span>CAPTION {cp.size_px}px · {cp.weight}{cp.mono ? " · mono" : ""}</span></div>}
            {tt && <div><i style={{ height: (tt.size_px / mx) * (full ? 60 : 36), background: col }} /><span>TITLE {tt.size_px}px · {tt.weight}</span></div>}
          </div>
        </div>
      );
    }
    case "textcolor": {
      const sw = [d.main && ["TEXT", d.main.hex], d.highlight && ["HIGHLIGHT", d.highlight.hex], d.title_colors?.[0] && ["TITLE", d.title_colors[0].hex]].filter(Boolean) as [string, string][];
      if (!sw.length) return <div className="vz-empty">No on-screen text</div>;
      return (
        <div className="vz-tc">
          {sw.map(([l, h]) => (
            <div key={l}>
              <div className="vz-aa" style={{ color: h, WebkitTextStroke: c.specs.some(([a, b]) => a === "Outline" && b !== "none") ? "1.5px #000" : undefined }}>Aa</div>
              <i style={{ background: h }} /><span>{l}</span><em>{h}</em>
            </div>
          ))}
        </div>
      );
    }
    case "motion": {
      const cv: number[] = d.curve || []; const mx = Math.max(0.01, ...cv);
      const dur = d.duration || 1;
      const tr = Object.entries(d.transitions || {}) as [string, number][]; const tt = tr.reduce((a, [, v]) => a + v, 0) || 1;
      const en = Object.entries(d.entrances || {}) as [string, number][]; const et = en.reduce((a, [, v]) => a + v, 0) || 1;
      return (
        <div className="vz-col">
          <svg className="vz-curve" viewBox="0 0 400 70" preserveAspectRatio="none" style={{ height: full ? 80 : 46 }}>
            <polyline points={cv.map((v, i) => `${(i / Math.max(1, cv.length - 1)) * 400},${66 - (v / mx) * 60}`).join(" ")} fill="none" stroke={col} strokeWidth="1.6" />
            {(d.cuts || []).map((t: number) => <line key={t} x1={(t / dur) * 400} x2={(t / dur) * 400} y1="0" y2="6" stroke="#f3eee6" strokeOpacity="0.6" />)}
          </svg>
          <div className="vz-chips">
            {tr.map(([k, v]) => <span key={k}>{k} <b>{pctN(v / tt)}</b></span>)}
            {en.slice(0, full ? 3 : 2).map(([k, v]) => <span key={k}>captions {k} <b>{pctN(v / et)}</b></span>)}
            {d.punch_ins > 0 && <span>punch-ins <b>{d.punch_ins}</b></span>}
          </div>
        </div>
      );
    }
    case "set": {
      const w = full ? 1 : 0;
      return (
        <div className="vz-col">
          {d.image && (
            <div className={"vz-set" + (w ? " full" : "")}>
              <img src={url(vid, d.image)} />
              {(d.points || []).filter(Boolean).map((p: any, i: number) => <i key={i} style={{ left: pctN(p.x), top: pctN(p.y), background: p.hex, boxShadow: `0 0 18px 6px ${p.hex}` }} />)}
            </div>
          )}
          <div className="vz-pal">{(d.palette || []).slice(0, 6).map((x: any) => <i key={x.hex} style={{ background: x.hex, flex: x.share }} title={x.hex} />)}</div>
        </div>
      );
    }
  }
  return null;
}
