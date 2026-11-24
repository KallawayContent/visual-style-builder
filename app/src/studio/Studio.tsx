// Visual Style Builder: the page. Drop a video or paste a link -> the analyzer measures its visual style -> the video
// splits into 7 layers in 3D. Click a layer to see and save its parts; combine saved parts into styles; export a guide.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Stage3D, { live, ViewMode, spreadDone } from "./Stage3D";
import { Viz } from "./viz";
import ScanFX, { SCAN_KINDS, ScanKind } from "./scanfx";
import { savedOrder } from "./SavedViewer";
import Combine, { Builder2, SaveVariant } from "./combine";
import {
  COMP_NUM, COMP_ORDER, COMP_SHORT, CompKey, LAYERS, LayerId, Pick, Saved, Style, VideoInfo,
  compColor, download, guideJSON, guideMarkdown, guideSVG, loadStyle, loadVideos, readLib, savedId, writeLib,
} from "./model";
import "./studio.css";

const Q = new URLSearchParams(location.search);
// site looks to compare
const THEMES: { id: string; name: string; sw: string }[] = [
  { id: "mono", name: "Mono", sw: "#ffffff" }, { id: "electric", name: "Electric", sw: "#4f6bff" }, { id: "acid", name: "Acid", sw: "#c6ff3d" },
  { id: "lilac", name: "Lilac", sw: "#b9a4ff" }, { id: "original", name: "Original", sw: "#ff9a4d" },
];
// what a video's style is made of, the most important first
const BULLETS: [string, string][] = [
  ["Layout & format", "#f3eee6"], ["B-roll & where it sits", "#3ddc97"], ["Subtitles & typography", "#ffd84d"],
  ["Pace & cuts", "#ff4fa3"], ["Motion & transitions", "#ff4fa3"], ["Person framing", "#ff9a4d"],
  ["Text color", "#ffd84d"], ["Set & lighting", "#5b8cff"], ["Color grade", "#b18cff"],
];
// one font family for the whole site; the title stays Space Grotesk
const FONTS = [
  { id: "grotesk", name: "Space Grotesk" }, { id: "geist", name: "Geist" }, { id: "inter", name: "Inter" }, { id: "dmsans", name: "DM Sans" },
  { id: "sora", name: "Sora" }, { id: "outfit", name: "Outfit" }, { id: "jakarta", name: "Jakarta" }, { id: "plex", name: "IBM Plex" }, { id: "manrope", name: "Manrope" },
];
function useTheme() {
  // LOCKED: Original + Space Grotesk + the pixel
  // grid scan, for every visitor; ?theme= ?font= ?scan= still work for tests
  const [th, setTh] = useState<string>(() => Q.get("theme") || "original");
  useEffect(() => { document.documentElement.dataset.theme = th; }, [th]);
  return [th, setTh] as const;
}
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

// the scan: one step per component
const STEP0 = 0.9, STEP = 0.78;
const SCAN_END = STEP0 + COMP_ORDER.length * STEP;
const EXPLODE0 = SCAN_END + 0.5;
const FOCUS: Partial<Record<CompKey, LayerId>> = { layout: "format", person: "character", broll: "broll", grade: "grade", subtitles: "text", motion: "motion", set: "set" };
// the frame the layers hold: a caption on screen, in the main layout, not near a cut, about a quarter into the video
function heroTime(a: any, s: Style) {
  const dur = a.duration, main = s.components.layout.data.main;
  const shotAt = (t: number) => a.shots.find((x: any) => t >= x.t0 && t < x.t1);
  const runAt = (t: number) => a.layout_runs.find((r: any) => t >= r.t0 && t < r.t1);
  const want = Math.min(Math.max(dur * 0.25, EXPLODE0 + 2), dur - 1);
  const items: any[] = s.components.broll?.data?.items || [];
  const bad = (t: number) => { const it = items.find((x) => t >= x.t0 && t < x.t1); return it && it.kind === "people" ? 1000 : 0; };
  const c = a.captions.filter((q: any) => q.kind === "caption" && q.box[3] >= 0.02).map((q: any) => (q.t0 + q.t1) / 2 + 0.05)
    .filter((t: number) => { const sh = shotAt(t), r = runAt(t); return sh && r && r.layout === main && (main === "b_full" || (sh.framing && sh.framing.person_height > 0.35)) && t - sh.t0 > 0.35 && sh.t1 - t > 0.3 && t < dur - 0.3; })
    // prefer a frame whose B-roll is a screen or footage (a B-roll of the speaker makes the layers hard to tell apart)
    .sort((x: number, y: number) => Math.abs(x - want) + bad(x) - Math.abs(y - want) - bad(y));
  let t = c[0];
  if (t == null) { const sh = [...a.shots].sort((x: any, y: any) => (y.t1 - y.t0) - (x.t1 - x.t0))[0]; t = sh ? (sh.t0 + sh.t1) / 2 : dur / 2; }
  return (Math.floor(t * 30) + 0.5) / 30;
}

function useLib() {
  const [lib, setLib] = useState<Saved[]>(readLib());
  useEffect(() => { const f = () => setLib(readLib()); window.addEventListener("styleminer-lib", f); window.addEventListener("storage", f); return () => { window.removeEventListener("styleminer-lib", f); window.removeEventListener("storage", f); }; }, []);
  return lib;
}

export default function Studio() {
  const lib = useLib();
  const [theme, setTheme] = useTheme();
  const [font, setFont] = useState<string>(() => Q.get("font") || "grotesk");
  const [scanKind, setScanKind] = useState<ScanKind>(() => (Q.get("scan") as ScanKind | null) || "grid");
  useEffect(() => { document.documentElement.dataset.font = font; }, [font]);
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [vid, setVid] = useState<string | null>(null);
  const [style, setStyle] = useState<Style | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [localURL, setLocalURL] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [scanStart, setScanStart] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [hover, setHoverRaw] = useState<LayerId | null>(null);
  const [pin, setPin] = useState<LayerId | null>(null);
  const [tab, setTab] = useState<"layers" | "saved">("layers");
  const [drawer, setDrawer] = useState(false);
  const [builder, setBuilder] = useState(false);
  const [hero, setHero] = useState(true);   // the video at the top (data/site/hook_v6.mp4); without the file the page starts at the title
  const [sound, setSound] = useState(false);
  const [heroSound, setHeroSound] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setModeRaw] = useState<ViewMode>(() => (Q.get("view") as ViewMode | null) || "still");
  const [pick, setPickRaw] = useState<Pick>(() => readPick(readLib()));
  useEffect(() => { setPickRaw(readPick(lib)); }, [lib.length]);
  const setPick = (x: Pick) => { setPickRaw(x); writePick(x); };
  const [sIdx, setSIdx] = useState(0);
  const [variant, setVariantRaw] = useState<SaveVariant>(() => {
    const q = Q.get("combine") as SaveVariant | null; if (q) return q;
    try { return (localStorage.getItem("styleminer.combine") as SaveVariant) || "mixer"; } catch { return "mixer"; }
  });
  const setVariant = (v: SaveVariant) => { setVariantRaw(v); try { localStorage.setItem("styleminer.combine", v); } catch {} };
  const items = useMemo(() => savedOrder(lib), [lib]);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLElement>(null);

  // the overlay scale comes from the stage box itself (not the window: the box is narrower when the window is wider than 16:9)
  useEffect(() => {
    if (!box) return;
    const f = () => setScale(box.clientWidth / 1920);
    f(); const ro = new ResizeObserver(f); ro.observe(box); return () => ro.disconnect();
  }, [box]);
  useEffect(() => { loadVideos().then(setVideos); }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => { if (scanStart != null) setT((performance.now() - scanStart) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [scanStart]);

  // hover leaves after a short delay, so the mouse can travel from a layer to the panel
  const hoverTimer = useRef<number | undefined>(undefined);
  const setHover = useCallback((l: LayerId | null) => {
    window.clearTimeout(hoverTimer.current);
    if (l) setHoverRaw(l); else hoverTimer.current = window.setTimeout(() => setHoverRaw(null), 350);
  }, []);

  const open = useCallback(async (id: string, at = 0) => {
    setVid(id); setPin(null); setHoverRaw(null);
    const [s, a] = await Promise.all([loadStyle(id), fetch(`/data/${id}/analysis.json`).then((r) => r.json())]);
    setStyle(s); setAnalysis(a); setLocalURL(null);
    setScanStart(performance.now() - at * 1000); setT(at);
    setTimeout(() => stageRef.current?.scrollIntoView({ behavior: at ? "auto" : "smooth" }), 50);
    loadVideos().then(setVideos);
  }, []);
  const setMode = (m: ViewMode) => {
    setModeRaw(m);
    setPin(null); setHoverRaw(null);
    if (scanStart != null && t > EXPLODE0) setScanStart(performance.now() - EXPLODE0 * 1000); // replay the spread in the new view
  };
  useEffect(() => { const v = Q.get("v"); if (v) open(v, Number(Q.get("t") || 0)); }, []);
  useEffect(() => { (window as any).__studio = { setTheme, setFont, setScanKind, open, setHover: setHoverRaw, setPin, setTab, setBuilder, setMode, setSIdx, setVariant }; (window as any).__live = live; });
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") setPin(null); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);

  // a running upload survives a page reload: the job id is kept in
  // localStorage; if the stream breaks or the page reloads, the page follows the job by polling /api/job until it is done
  const JOBK = "styleminer.job";
  const tidy = (lines: string[]) => { const pr = lines.filter((l) => l.startsWith("progress")).slice(-1); return [...lines.filter((l) => !l.startsWith("progress")), ...pr]; };
  const follow = useCallback((id: string, name: string) => {
    const tick = async () => {
      try {
        const r = await fetch(`/api/job?id=${id}`);
        if (r.ok) {
          const j = await r.json();
          setLog([`uploading ${name}`, ...tidy(j.lines || [])]);
          if (j.done) { try { localStorage.removeItem(JOBK); } catch {} setTimeout(() => open(id), 300); return; }
          if (j.error || !j.running) { try { localStorage.removeItem(JOBK); } catch {} if (!j.error) setLog((x) => [...x, "error the analysis stopped; drop the video again"]); return; }
        } else if (r.status === 404) { try { localStorage.removeItem(JOBK); } catch {} return; }
      } catch {}
      setTimeout(tick, 1500);
    };
    tick();
  }, [open]);
  useEffect(() => {
    let j: any = null;
    try { j = JSON.parse(localStorage.getItem(JOBK) || "null"); } catch {}
    if (!j || Date.now() - j.at > 30 * 60 * 1000 || Q.get("v")) return;
    setStyle(null); setAnalysis(null); setScanStart(null); setVid(null);
    setLocalURL(`/data/${j.id}/src_cut.mp4`); setFileName(j.name); setLog([`uploading ${j.name}`]);
    setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth" }), 400);
    follow(j.id, j.name);
  }, []);

  const onFile = useCallback(async (file: File, handle = "") => {
    // a file analyzed before opens at once with the scan animation (no upload, no progress list)
    try {
      // the same bytes, or the same video in other bytes (another download of the same reel): /api/match
      const j = await (await fetch("/api/match", { method: "POST", body: file })).json();
      if (j.id) { open(j.id); return; }
    } catch {}
    setStyle(null); setAnalysis(null); setScanStart(null); setVid(null);
    setLocalURL(URL.createObjectURL(file)); setFileName(file.name);
    setLog([`uploading ${file.name}`]);
    setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    let r: Response;
    try { r = await fetch("/api/analyze", { method: "POST", body: file, headers: { "x-filename": encodeURIComponent(file.name), ...(handle ? { "x-handle": encodeURIComponent(handle) } : {}) } }); }
    catch { setLog((x) => [...x, "error the upload did not reach the analyzer (is the site server running?)"]); return; }
    if (!r.ok || !r.body) { setLog((x) => [...x, `error the analyzer answered ${r.status}`]); return; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    let jobId = "", finished = false;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const l of lines) {
          const jm = l.match(/^job (\S+)/);
          if (jm) { jobId = jm[1]; try { localStorage.setItem(JOBK, JSON.stringify({ id: jobId, name: file.name, at: Date.now() })); } catch {} continue; }
          if (l === "attach") continue;
          setLog((x) => tidy([...x, l]));
          const m = l.match(/^done (\S+)$/);
          if (m) { finished = true; try { localStorage.removeItem(JOBK); } catch {} const cached = lines.some((q) => q.startsWith("cached")); setTimeout(() => open(m[1]), cached ? 900 : 300); }
          if (l.startsWith("error")) { finished = true; try { localStorage.removeItem(JOBK); } catch {} }
        }
      }
    } catch {}
    // the stream ended without "done" (a server restart, a dropped connection, or another tab runs the same file): follow the job
    if (!finished && jobId) follow(jobId, file.name);
  }, [open, follow]);

  const heroT = useMemo(() => (style && analysis ? heroTime(analysis, style) : 0), [style, analysis]);
  const busy = !!localURL && !style;
  const xt = t - EXPLODE0;
  const sDone = spreadDone(mode);
  const stepI = style && scanStart != null ? Math.floor((t - STEP0) / STEP) : -1;
  const scanning = !!style && xt < 0.3;
  const curKey = stepI >= 0 && stepI < COMP_ORDER.length ? COMP_ORDER[stepI] : null;
  const stepU = curKey ? (t - STEP0 - stepI * STEP) / STEP : 0;
  const focus = curKey ? FOCUS[curKey] || null : null;
  const focusAmt = curKey ? seg(stepU, 0, 0.18) * (1 - seg(stepU, 0.82, 1)) : 0;
  const ready = xt > sDone * 0.85;
  // a click (pin) wins over hover: the mouse crosses other layers on its way to the panel
  const active = ready ? (pin || hover) : null;

  const vinfo = videos.find((v) => v.id === vid);
  const isSaved = (k: CompKey) => !!style && lib.some((s) => s.uid === savedId(style.id, k));
  const entry = (k: CompKey): Saved => ({ uid: savedId(style!.id, k), vid: style!.id, source: vinfo?.name || style!.id, handle: vinfo?.handle || "", key: k, comp: style!.components[k], thumb: style!.thumb, at: Date.now() });
  const say = (s: string) => { setToast(s); setTimeout(() => setToast(null), 1800); };
  const toggleSave = (k: CompKey) => {
    if (!style) return;
    if (isSaved(k)) { writeLib(lib.filter((s) => s.uid !== savedId(style.id, k))); return; }
    writeLib([...lib, entry(k)]); say(`Saved ${COMP_SHORT[k]} · ${vinfo?.handle || vinfo?.name || style.id}`);
  };
  const saveLayer = (l: LayerId) => {
    if (!style) return;
    const L = LAYERS.find((x) => x.id === l)!;
    if (L.comps.every(isSaved)) { writeLib(lib.filter((s) => !L.comps.some((k) => s.uid === savedId(style.id, k)))); return; }
    writeLib([...lib.filter((s) => !L.comps.some((k) => s.uid === savedId(style.id, k))), ...L.comps.map(entry)]);
    say(`Saved ${L.name} · ${vinfo?.handle || vinfo?.name || style.id}`);
  };

  // drag to orbit
  const onDown = (e: React.PointerEvent) => { if (!ready) return; live.drag.on = true; live.drag.x = e.clientX; live.drag.y = e.clientY; live.drag.moved = 0; };
  const onMove = (e: React.PointerEvent) => {
    const d = live.drag; if (!d.on) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    d.az = clamp(d.az - dx * 0.18, -50, 55); d.el = clamp(d.el + dy * 0.12, -12, 22);
  };
  const onUp = () => { live.drag.on = false; };
  const openBuilderNav = () => { setBuilder(true); if (location.hash !== "#styles") history.pushState({ sm: "styles" }, "", "#styles"); };
  const closeBuilder = () => { if (history.state?.sm === "styles") history.back(); else { setBuilder(false); if (location.hash === "#styles") history.replaceState(null, "", location.pathname + location.search); } };
  useEffect(() => {
    if (location.hash === "#styles") setBuilder(true);
    const f = () => setBuilder(location.hash === "#styles");
    window.addEventListener("popstate", f); return () => window.removeEventListener("popstate", f);
  }, []);
  const openSaved = openBuilderNav;

  return (
    <div className="sm">
      <nav className="sm-nav">
        <div />
        <div className="sm-nav-r">
          <button className={"sm-libbtn" + (lib.length ? " has" : "")} onClick={openSaved}>Saved styles <b>{lib.length}</b></button>
        </div>
      </nav>

      {hero && <header className="sm-hero">
        <video src="/data/site/hook_v6.mp4" autoPlay muted={!heroSound} loop playsInline onError={() => setHero(false)} />
        <button className="sm-sound" onClick={() => setHeroSound((x) => !x)}>{heroSound ? "Sound on" : "Sound off"}</button>
        <div className="sm-cue">Scroll to mine a video</div>
      </header>}

      <section className="sm-try" id="try">
        <h1 className="sm-h1">Visual Style Builder</h1>
        <ul className="sm-bul">
          {BULLETS.map(([t, c]) => <li key={t}><i style={{ background: c }} />{t}</li>)}
        </ul>
        <div className={"sm-drop" + (dragOver ? " over" : "") + (busy ? " busy" : "")}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
          onClick={() => document.getElementById("sm-file")?.click()}>
          <input id="sm-file" type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <div className="sm-drop-ring" />
          <div className="sm-drop-in">
            <div className="sm-drop-icon"><span /><span /><span /></div>
            <div className="sm-drop-big">{busy ? "Mining…" : "Drop a short-form video"}</div>
            <div className="sm-drop-sub">MP4 or MOV · the first 60 seconds are read</div>
          </div>
        </div>
        <LinkBox busy={busy} onFile={onFile} onOpen={(id) => open(id)} />
        {videos.length > 0 && (
          <div className="sm-shelf">
            <div className="sm-eyebrow small">PREVIOUS VIDEOS</div>
            <div className="sm-shelf-row">
              {videos.map((v) => (
                <button key={v.id} className={"sm-vcard" + (v.id === vid ? " on" : "")} onClick={() => open(v.id)}>
                  {v.thumb && <img src={`/data/${v.id}/${v.thumb}`} />}
                  <span>{v.handle || v.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {(busy || style) && (
        <section className="sm-stage" ref={stageRef}>
          <div className="sm-stage-box" ref={setBox} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
            <div className="sm-bg" />
            {style && analysis && scanStart != null && (
              <div className={"s3-wrap" + (tab === "saved" && ready ? " off" : "")}><Stage3D style={style} analysis={analysis} heroT={heroT} mode={mode} xt={xt} runId={scanStart}
                focus={scanning ? focus : null} focusAmt={focusAmt}
                active={active} pin={ready ? pin : null} onMiss={() => setPin(null)}
                onHover={setHover} onPick={(l) => { setTab("layers"); setPin((x) => (x === l ? null : l)); }} sound={sound} /></div>
            )}
            <div className="sm-ui" style={{ transform: `scale(${scale})` }}>
              {busy && <Processing url={localURL!} name={fileName} log={log} />}
              {style && <Overlay t={t} xt={xt} sDone={sDone} style={style} analysis={analysis} vinfo={vinfo} stepI={stepI} stepU={stepU}
                active={active} pin={pin} setHover={setHover} setPin={setPin} tab={tab} setTab={setTab}
                isSaved={isSaved} toggleSave={toggleSave} saveLayer={saveLayer} lib={lib}
                pick={pick} setPick={setPick} items={items} sIdx={sIdx} setSIdx={setSIdx} variant={variant} setVariant={setVariant} scanKind={scanKind}
                sound={sound} setSound={setSound} replay={() => setScanStart(performance.now())} openBuilder={openBuilderNav} openDrawer={openBuilderNav} />}
            </div>
            <div className="sm-grain" />
          </div>
        </section>
      )}

      <footer className="sm-foot">Visual Style Builder · every value is measured from the video's own pixels · a style guide is for making your own work, not a copy of someone else's.</footer>

      {drawer && <Drawer lib={lib} close={() => setDrawer(false)} build={() => { setDrawer(false); openBuilderNav(); }} />}
      {builder && <Builder2 lib={lib} close={closeBuilder} fx={{ heroTime, Marks: ScanMarks }} />}
      {toast && <div className="sm-toast">★ {toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- processing (a new upload, before the data exists)
// "or paste a link": the server downloads it (/api/fetch, yt-dlp, anonymous), then it goes through the same path as a dropped file
function LinkBox({ busy, onFile, onOpen }: { busy: boolean; onFile: (f: File, handle?: string) => void; onOpen: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"" | "loading" | string>("");
  const go = async () => {
    const u = url.trim(); if (!u || state === "loading" || busy) return;
    setState("loading");
    try {
      const r = await fetch("/api/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) });
      if (!r.ok) { let m = `The download failed (${r.status}).`; try { m = (await r.json()).error || m; } catch {} setState(m); return; }
      if ((r.headers.get("content-type") || "").includes("json")) {   // analyzed before: open it with the scan animation
        const j = await r.json(); setState(""); setUrl(""); if (j.id) onOpen(j.id); return;
      }
      const name = decodeURIComponent(r.headers.get("x-filename") || "video.mp4"), handle = decodeURIComponent(r.headers.get("x-handle") || "");
      const blob = await r.blob();
      setState(""); setUrl("");
      onFile(new File([blob], name, { type: "video/mp4" }), handle);
    } catch { setState("The site server did not answer. Is it running?"); }
  };
  return (
    <div className="sm-link">
      <span className="sm-link-or">or paste a link</span>
      <div className={"sm-link-row" + (state === "loading" ? " on" : "")}>
        <input value={url} onChange={(e) => { setUrl(e.target.value); if (state && state !== "loading") setState(""); }} onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder="Instagram, TikTok or YouTube link" spellCheck={false} disabled={state === "loading"} />
        <button onClick={go} disabled={!url.trim() || state === "loading" || busy}>{state === "loading" ? "Downloading…" : "Get video"}</button>
      </div>
      {state && state !== "loading" && <div className="sm-link-err">{state}</div>}
    </div>
  );
}

function Processing({ url, name, log }: { url: string; name: string; log: string[] }) {
  const has = (re: RegExp) => log.some((l) => re.test(l));
  const last = (re: RegExp) => [...log].reverse().find((l) => re.test(l));
  const pm = last(/^progress mattes/)?.split(" ");
  const mp = pm ? Math.round((100 * Number(pm[2])) / Math.max(1, Number(pm[3]))) : 0;
  const pk = last(/^step pack \d/)?.match(/(\d+)\/(\d+)/);
  const pp = pk ? Math.round((100 * Number(pk[1])) / Number(pk[2])) : 0;
  const steps: [boolean, boolean, string][] = [
    [true, has(/^saved|^cached/), "Uploading"],
    [has(/^saved|^cached/), has(/^frames|^cached/), "Reading the frames"],
    [has(/^frames|^cached/), has(/^prep done|^cached/), `Cutting out the person${pm && !has(/^prep done/) ? ` · ${mp}%` : ""}`],
    [has(/^step matte|^cached/), has(/^done rvm|^step cuts|^step layout|^cached/), "Sharpening the cut-out"],
    [has(/^done rvm|^step cuts|^step layout|^cached/), has(/^step layout|^cached/), "Finding every cut and the layout"],
    [has(/^step layout|^cached/), has(/^step pack|^cached/), "Reading the on-screen text"],
    [has(/^step pack|^cached/), has(/^step packed|^cached/), `Separating the layers${pk && !has(/^step packed/) ? ` · ${pp}%` : ""}`],
    [has(/^step packed|^cached/), has(/^step deep frames|^cached/), "Measuring the set"],
    [has(/^step deep frames|^cached/), has(/^done (?!rvm)/), "Extracting the style components"],
  ];
  const err = last(/^error/);
  return (
    <div className="pr">
      <div className="pr-card">
        <video src={url} autoPlay muted loop playsInline />
        <div className="pr-scan" /><div className="pr-grid" />
        <div className="pr-name">{name}</div>
      </div>
      <div className="pr-steps">
        <div className="sm-eyebrow">MINING</div>
        <div className="pr-title">Reading every frame</div>
        {steps.map(([on, ok, l]) => <div key={l.slice(0, 14)} className={"pr-step" + (ok ? " ok" : on ? " run" : "")}><i />{l}</div>)}
        <div className="pr-note">{err ? "Something went wrong: " + err.replace(/^error\s*/, "") : "A new video takes 1-4 minutes (longer videos take longer). The same file again opens at once."}</div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------- the overlay on the stage (1920 x 1080 space)
type OP = {
  t: number; xt: number; sDone: number; style: Style; analysis: any; vinfo?: VideoInfo; stepI: number; stepU: number;
  active: LayerId | null; pin: LayerId | null; setHover: (l: LayerId | null) => void; setPin: (l: LayerId | null) => void;
  tab: "layers" | "saved"; setTab: (t: "layers" | "saved") => void;
  isSaved: (k: CompKey) => boolean; toggleSave: (k: CompKey) => void; saveLayer: (l: LayerId) => void; lib: Saved[];
  pick: Pick; setPick: (p: Pick) => void; items: Saved[]; sIdx: number; setSIdx: (i: number) => void;
  variant: SaveVariant; setVariant: (v: SaveVariant) => void; scanKind: ScanKind;
  sound: boolean; setSound: (f: (x: boolean) => boolean) => void; replay: () => void; openBuilder: () => void; openDrawer: () => void;
};
function Overlay(p: OP) {
  const { t, style } = p;
  const r = live.rect;
  const scanO = (1 - seg(p.xt, -0.2, 0.6)) * seg(t, 0.1, 0.6);
  const liveO = seg(p.xt, p.sDone - 0.6, p.sDone + 0.4);
  const n = COMP_ORDER.length;
  const done = Math.max(0, Math.min(n, p.stepI + (p.stepI >= 0 ? (p.stepU > 0.5 ? 1 : 0) : 0)));
  const key = p.stepI >= 0 && p.stepI < n ? COMP_ORDER[p.stepI] : null;
  const name = p.vinfo ? `${p.vinfo.handle ? p.vinfo.handle + " · " : ""}${p.vinfo.name}` : style.id;
  const viewer = p.tab === "saved";
  const showRegions = !viewer && p.xt > p.sDone && (!p.active || p.active === "format");
  return (
    <>
      {scanO > 0.01 && (
        <div style={{ opacity: scanO }}>
          <div className="sc-left">
            <div className="sm-eyebrow">STYLE EXTRACTION</div>
            <div className="sc-count"><b>{String(done).padStart(2, "0")}</b> / {n}</div>
            <div className="sc-bar"><i style={{ width: `${(done / n) * 100}%` }} /></div>
            <div className="sc-list">
              {COMP_ORDER.map((k, i) => (
                <div key={k} className={"sc-item" + (i < p.stepI || (i === p.stepI && p.stepU > 0.5) ? " ok" : i === p.stepI ? " on" : "")}>
                  <span style={{ color: compColor(k) }}>{COMP_NUM[k]}</span>{COMP_SHORT[k]}
                </div>
              ))}
            </div>
          </div>
          <div className="sc-frame" style={{ left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 }}>
            {r.x1 - r.x0 > 50 && <ScanFX kind={p.scanKind} w={Math.round(r.x1 - r.x0)} h={Math.round(r.y1 - r.y0)} amt={0.9} />}
            <div className="br tl" /><div className="br tr" /><div className="br bl" /><div className="br brr" />
            {key && <ScanMarks k={key} u={p.stepU} style={style} analysis={p.analysis} />}
          </div>
          {key && <Finding k={key} u={p.stepU} style={style} />}
          <div className="sc-file">{name} · {Math.round(style.duration)} s</div>
        </div>
      )}
      {liveO > 0.01 && (
        <div style={{ opacity: liveO }}>
          {!viewer && LAYERS.map((l, i) => {
            const pos = live.labels[l.id]; if (!pos) return null;
            const on = p.active === l.id;
            const pr = live.pinRect;
            if (pr && !on && pos[0] > pr.x0 - 160 && pos[0] < pr.x1 && pos[1] > pr.y0 - 10 && pos[1] < pr.y1 + 30) return null;   // under the pulled-out layer
            const playing = live.playing === l.id && !p.active;
            const saved = l.comps.every(p.isSaved);
            return (
              <div key={l.id} className={"lb" + (on ? " on" : "") + (playing ? " play" : "") + (p.active && !on ? " dim" : "")} style={{ left: pos[0], top: pos[1], borderColor: l.color }}
                onMouseEnter={() => p.setHover(l.id)} onMouseLeave={() => p.setHover(null)} onClick={() => { p.setTab("layers"); p.setPin(p.pin === l.id ? null : l.id); }}>
                <span style={{ color: l.color }}>{String(LAYERS.length - i).padStart(2, "0")}</span>{l.name}{saved && <em className="lb-star">★</em>}
              </div>
            );
          })}
          {showRegions && live.regions.map((g) => <div key={g.name} className="rg" style={{ left: g.x, top: g.y, background: g.color }}>{g.name}</div>)}
          {viewer && <Combine lib={p.lib} pick={p.pick} setPick={p.setPick} variant={p.variant} setVariant={p.setVariant} back={() => p.setTab("layers")} heroTime={heroTime} Marks={ScanMarks} />}
          {!viewer && <div className="lv-head">
            <div className="sm-eyebrow">STYLE STACK · {n} COMPONENTS</div>
            {(() => {
              const name = p.vinfo?.name || style.id, h = (p.vinfo?.handle || "").replace(/^@/, "");
              let title = name;
              if (h) title = title.replace(new RegExp(`^(video by\\s+)?${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[\\s:·-]*`, "i"), "").trim();
              return <>
                <div className="lv-name">{h || name}</div>
                {h && title && <div className="lv-title">{title}</div>}
              </>;
            })()}
            {p.vinfo?.handle && <div className="lv-handle">{p.vinfo.handle}</div>}
          </div>}
          {!viewer && <Panel {...p} />}
          {!viewer && <div className="lv-tools">
            <button onClick={p.replay}>Replay scan</button>
            <button onClick={() => p.setSound((x) => !x)}>{p.sound ? "Sound on" : "Sound off"}</button>
          </div>}
          {!viewer && <div className="lv-hint">Drag to orbit · click a layer to save it</div>}
        </div>
      )}
    </>
  );
}

// the marks drawn on the flat video for each scan step (all from the data)
function ScanMarks({ k, u, style, analysis, vt: vtIn }: { k: CompKey; u: number; style: Style; analysis: any; vt?: number }) {
  const c = style.components[k]; const d = c.data || {}; const col = compColor(k);
  const a = easeOut(seg(u, 0.05, 0.35)) * (1 - seg(u, 0.88, 1));
  const vt = vtIn ?? live.vt;
  const pc = (x: number) => `${x * 100}%`;
  if (k === "layout") {
    const seam = d.seam ?? 0.5;
    return (<div className="mk" style={{ opacity: a }}>
      {d.main === "split" || (d.share?.split || 0) > 0.3 ? (<>
        <div className="mk-box" style={{ left: "2%", right: "2%", top: "1%", height: pc(seam - 0.02), borderColor: "#3ddc97" }}><span style={{ background: "#3ddc97" }}>B-ROLL · TOP</span></div>
        <div className="mk-box" style={{ left: "2%", right: "2%", top: pc(seam + 0.01), bottom: "1%", borderColor: "#ff9a4d" }}><span style={{ background: "#ff9a4d" }}>SPEAKER · BOTTOM</span></div>
        <div className="mk-seam" style={{ top: pc(seam), width: `${seg(u, 0.05, 0.4) * 100}%` }} />
      </>) : <div className="mk-box" style={{ inset: "1% 2%", borderColor: col }}><span style={{ background: col, color: "#111" }}>{d.main === "a_full" ? "FULL-FRAME SPEAKER" : "FULL-SCREEN B-ROLL"}</span></div>}
    </div>);
  }
  if (k === "pace") {
    const cuts: number[] = d.cuts || []; const dur = d.duration || 1; const p = seg(u, 0.05, 0.7);
    return (<div className="mk" style={{ opacity: a }}>
      <div className="mk-tl">{cuts.filter((x) => x / dur <= p).map((x) => <i key={x} style={{ left: pc(x / dur), background: col }} />)}<b style={{ left: pc(p) }} /></div>
      <div className="mk-big" style={{ color: col }}>{cuts.filter((x) => x / dur <= p).length}<small>CUTS FOUND · {style.components.pace.specs[1]?.[1]} A SHOT</small></div>
    </div>);
  }
  if (k === "person") {
    const bot = d.area === "bottom";
    const ey = d.eye_y != null ? (bot ? 0.5 + d.eye_y * 0.5 : d.eye_y) : null;
    return (<div className="mk" style={{ opacity: a }}>
      {ey != null && <div className="mk-h" style={{ top: pc(ey), borderColor: col }}><span style={{ color: col }}>EYE LINE {Math.round((d.eye_y || 0) * 100)}%</span></div>}
      {d.cx != null && <div className="mk-v" style={{ left: pc(d.cx), top: bot ? "50%" : 0, borderColor: col }} />}
      {d.headroom != null && <div className="mk-h thin" style={{ top: pc((bot ? 0.5 : 0) + d.headroom * (bot ? 0.5 : 1)), borderColor: col }}><span style={{ color: col }}>HEADROOM</span></div>}
      <div className="mk-tag" style={{ background: col, top: bot ? "53%" : "4%" }}>{style.components.person.specs[0]?.[1]?.toUpperCase()}</div>
    </div>);
  }
  if (k === "broll" || k === "broll_framing") {
    const rr = style.components.broll_framing.data.rect || [0, 0, 1, 0.5];
    const it = (style.components.broll.data.items || []).find((x: any) => vt >= x.t0 && vt < x.t1) || (style.components.broll.data.items || [])[0];
    if (!it) return <div className="mk" style={{ opacity: a }}><div className="mk-tag" style={{ background: col, top: "4%" }}>NO B-ROLL</div></div>;
    return (<div className="mk" style={{ opacity: a }}>
      <div className={"mk-box" + (k === "broll_framing" ? " brk" : "")} style={{ left: pc(rr[0] + 0.02), top: pc(rr[1] + 0.01), width: pc(rr[2] - rr[0] - 0.04), height: pc(rr[3] - rr[1] - 0.03), borderColor: col }}>
        <span style={{ background: col }}>{k === "broll" ? `${it.kind.toUpperCase()} · ${(it.tag || "").toUpperCase()}` : `${it.where.toUpperCase()} · ${it.move.toUpperCase()}`}</span>
      </div>
    </div>);
  }
  if (k === "grade") {
    const g = d.aroll || d.broll || {};
    return (<div className="mk" style={{ opacity: a }}>
      <div className="mk-pal">{[g.shadows, g.mids, g.highlights].map((h: string, i: number) => <i key={i} style={{ background: h, transform: `translateX(${(1 - easeOut(seg(u, 0.1 + i * 0.08, 0.4 + i * 0.08))) * -40}px)` }}><span>{["SHADOWS", "MIDS", "HIGHLIGHTS"][i]}</span></i>)}</div>
    </div>);
  }
  if (k === "subtitles" || k === "typography" || k === "textcolor") {
    const on = (analysis?.captions || []).filter((q: any) => vt >= q.t0 - 0.05 && vt <= q.t1 + 0.2 && q.box[3] >= 0.02);
    const crop = (style.components.typography.data.crops || [])[0];
    const tc = style.components.textcolor.data;
    return (<div className="mk" style={{ opacity: a }}>
      {on.slice(0, 3).map((q: any, i: number) => (
        <div key={i} className="mk-box tight" style={{ left: pc(q.box[0] - 0.02), top: pc(q.box[1] - 0.01), width: pc(q.box[2] + 0.04), height: pc(q.box[3] + 0.02), borderColor: col }}>
          {i === 0 && <span style={{ background: col, color: "#111" }}>{k === "subtitles" ? `"${q.text}"` : k === "typography" ? (style.components.typography.specs[1]?.[1] || style.components.typography.specs[0]?.[1] || "").toUpperCase() : (tc.main?.hex || "").toUpperCase()}</span>}
        </div>
      ))}
      {k === "typography" && crop && <img className="mk-crop" src={`/data/${style.id}/${crop.file}`} style={{ transform: `scale(${0.85 + 0.15 * easeOut(seg(u, 0.15, 0.5))})` }} />}
      {k === "textcolor" && tc.main && <div className="mk-drops">{[tc.main, tc.highlight].filter(Boolean).map((x: any) => <i key={x.hex} style={{ background: x.hex }}><span>{x.hex}</span></i>)}</div>}
    </div>);
  }
  if (k === "motion") {
    return (<div className="mk" style={{ opacity: a }}><div className="mk-tag" style={{ background: col, top: "4%" }}>{c.headline.toUpperCase()}</div></div>);
  }
  if (k === "set") {
    return (<div className="mk" style={{ opacity: a }}>
      {(d.points || []).filter(Boolean).map((q: any, i: number) => {
        const bot = d.area === "bottom";
        return <i key={i} className="mk-light" style={{ left: pc(q.x), top: pc(bot ? 0.5 + q.y * 0.5 : q.y), background: q.hex, boxShadow: `0 0 24px 8px ${q.hex}` }} />;
      })}
      <div className="mk-tag" style={{ background: col, top: "4%" }}>PERSON REMOVED · {c.specs[0]?.[1]?.toUpperCase()}</div>
    </div>);
  }
  return null;
}

function Finding({ k, u, style }: { k: CompKey; u: number; style: Style }) {
  const c = style.components[k];
  const o = easeOut(seg(u, 0.0, 0.25)) * (1 - seg(u, 0.9, 1));
  return (
    <div className="sc-find" style={{ opacity: o, transform: `translateY(${(1 - o) * 18}px)`, borderColor: compColor(k) }}>
      <div className="sc-find-n" style={{ color: compColor(k) }}>{COMP_NUM[k]} · {c.title.toUpperCase()}</div>
      <div className="sc-find-h">{c.headline}</div>
      <div className="sc-find-v"><Viz c={c} vid={style.id} /></div>
    </div>
  );
}


// ---------------------------------------------------------------- the panel on the right: tabs Layers | Saved
function readPick(lib: Saved[]): Pick {
  let ids: Record<string, string> = {};
  try { ids = JSON.parse(localStorage.getItem("styleminer.pick") || "{}"); } catch {}
  const p: Pick = {};
  COMP_ORDER.forEach((k) => {
    const mine = lib.filter((s) => s.key === k);
    const it = mine.find((s) => s.uid === ids[k]) || (ids[k] === "" ? undefined : mine.sort((a, b) => b.at - a.at)[0]);
    if (it) p[k] = it;
  });
  return p;
}
export function writePick(p: Pick) {
  const ids: Record<string, string> = {};
  COMP_ORDER.forEach((k) => { ids[k] = p[k]?.uid || ""; });
  try { localStorage.setItem("styleminer.pick", JSON.stringify(ids)); } catch {}
}

function Panel(p: OP) {
  return (
    <div className="pn">
      <div className="pn-tabs">
        <button className={p.tab === "layers" ? "on" : ""} onClick={() => { p.setTab("layers"); p.setPin(null); }}>Layers</button>
        <button onClick={() => p.openDrawer()}>Saved styles <b>{p.lib.length}</b></button>
      </div>
      <LayersTab {...p} />
    </div>
  );
}

function LayersTab(p: OP) {
  const { style } = p;
  // only a click changes the panel: hover on a row only lights the layer in the stack
  const L = p.pin ? LAYERS.find((l) => l.id === p.pin)! : null;
  if (!L) {
    return (
      <div className="pn-body">
        {[...LAYERS].reverse().map((l, i) => (
          <div key={l.id} className={"pn-row" + (p.active === l.id ? " hot" : "")} onMouseEnter={() => p.setHover(l.id)} onMouseLeave={() => p.setHover(null)} onClick={() => p.setPin(l.id)}>
            <span className="pn-n" style={{ color: l.color }}>{String(i + 1).padStart(2, "0")}</span>
            <div><b>{l.name}{l.comps.every(p.isSaved) && <em className="pn-star">★</em>}</b><em>{style.components[l.comps[0]].headline}</em></div>
          </div>
        ))}
      </div>
    );
  }
  const idx = LAYERS.length - LAYERS.indexOf(L);
  const all = L.comps.every(p.isSaved);
  return (
    <div className="pn-body">
      <button className="pn-back" onClick={() => p.setPin(null)}><i>←</i>All layers</button>
      <div className="pn-head"><span style={{ color: L.color }}>{String(idx).padStart(2, "0")}</span>{L.name.toUpperCase()}</div>
      {L.comps.length === 1 ? (
        <button className={"pn-book" + (all ? " on" : "")} style={{ ["--c" as any]: L.color }} onClick={() => p.saveLayer(L.id)}>
          <i>{all ? "✓" : "+"}</i>{all ? <><span className="pn-sv">Saved</span><span className="pn-us">Unsave</span></> : `Save ${L.name.toLowerCase()} style`}
        </button>
      ) : (
        <div className="pn-books">
          {L.comps.map((k) => {
            const on = p.isSaved(k);
            return (
              <button key={k} className={"pn-book" + (on ? " on" : "")} style={{ ["--c" as any]: L.color }} onClick={() => p.toggleSave(k)}>
                <i>{on ? "✓" : "+"}</i>{on ? <><span className="pn-sv">Saved {COMP_SHORT[k].toLowerCase()}</span><span className="pn-us">Unsave</span></> : `Save ${COMP_SHORT[k].toLowerCase()} style`}
              </button>
            );
          })}
        </div>
      )}
      {L.comps.map((k) => {
        const c = style.components[k];
        return (
          <div key={k} className="pn-comp">
            <div className="pn-ct"><span>{c.title}</span>
</div>
            <div className="pn-h">{c.headline}</div>
            <Viz c={c} vid={style.id} />
            <div className="pn-specs">{c.specs.slice(0, L.comps.length > 1 ? 2 : 4).map(([a, b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the library drawer
function Drawer({ lib, close, build }: { lib: Saved[]; close: () => void; build: () => void }) {
  const groups = COMP_ORDER.map((k) => [k, lib.filter((s) => s.key === k)] as const).filter(([, v]) => v.length);
  const vids = new Set(lib.map((s) => s.vid)).size;
  return (
    <div className="dw-wrap" onClick={close}>
      <aside className="dw" onClick={(e) => e.stopPropagation()}>
        <div className="dw-top"><div><div className="sm-eyebrow">LIBRARY</div><div className="dw-t">{lib.length} components · {vids} video{vids === 1 ? "" : "s"}</div></div><button className="pn-x" onClick={close}>×</button></div>
        {!lib.length && <div className="dw-empty">Click a layer of a video, then + Save. Saved parts from every video collect here.</div>}
        <div className="dw-list">
          {groups.map(([k, items]) => (
            <div key={k} className="dw-g">
              <div className="dw-gt" style={{ color: compColor(k) }}>{COMP_NUM[k]} {COMP_SHORT[k].toUpperCase()} <em>{items.length}</em></div>
              {items.map((s) => (
                <div key={s.uid} className="dw-it">
                  {s.thumb && <img src={`/data/${s.vid}/${s.thumb}`} />}
                  <div><b>{s.comp.headline}</b><span>{s.handle || s.source}</span></div>
                  <button onClick={() => writeLib(lib.filter((x) => x.uid !== s.uid))}>×</button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button className="gd-b main dw-build" disabled={!lib.length} onClick={build}>Build a style →</button>
      </aside>
    </div>
  );
}
