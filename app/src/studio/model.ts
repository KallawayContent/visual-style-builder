// The style model: the components of a video (style.json from analyzer/style_deep.py), the 3D layers that hold them,
// the saved library (localStorage) and the exports (Markdown, JSON, an SVG board).

export type CompKey = "layout" | "pace" | "person" | "broll" | "broll_framing" | "grade" | "subtitles" | "typography" | "textcolor" | "motion" | "set";
export type Comp = { key: CompKey; title: string; headline: string; specs: [string, string][]; data: any; rules: string[] };
export type Style = { id: string; source: string; duration: number; thumb: string | null; order: CompKey[]; titles: Record<CompKey, string>; components: Record<CompKey, Comp> };
export type VideoInfo = { id: string; name: string; handle: string; duration: number; thumb: string | null; demo?: boolean };

export const COMP_ORDER: CompKey[] = ["layout", "pace", "person", "broll", "broll_framing", "grade", "subtitles", "typography", "textcolor", "motion", "set"];
export const COMP_NUM: Record<CompKey, string> = Object.fromEntries(COMP_ORDER.map((k, i) => [k, String(i + 1).padStart(2, "0")])) as any;
export const COMP_SHORT: Record<CompKey, string> = {
  layout: "Layout", pace: "Pace", person: "Framing", broll: "B-roll", broll_framing: "B-roll position", grade: "Color grade",
  subtitles: "Subtitles", typography: "Typography", textcolor: "Text color", motion: "Motion", set: "Set & light",
};

// the 3D layers, back to front; each holds one or more components
export type LayerId = "set" | "grade" | "motion" | "character" | "format" | "broll" | "text";
export const LAYERS: { id: LayerId; name: string; color: string; comps: CompKey[]; kind: number }[] = [
  { id: "set", name: "Set & light", color: "#5b8cff", comps: ["set"], kind: 0 },
  { id: "grade", name: "Color grade", color: "#b18cff", comps: ["grade"], kind: 8 },
  { id: "motion", name: "Motion & pace", color: "#ff4fa3", comps: ["motion", "pace"], kind: 3 },
  { id: "character", name: "Person", color: "#ff9a4d", comps: ["person"], kind: 1 },
  { id: "format", name: "Layout", color: "#f3eee6", comps: ["layout"], kind: 4 },
  { id: "broll", name: "B-roll", color: "#3ddc97", comps: ["broll", "broll_framing"], kind: 2 },
  { id: "text", name: "Type & subtitles", color: "#ffd84d", comps: ["subtitles", "typography", "textcolor"], kind: 5 },
];
export const LAYER_OF: Record<CompKey, (typeof LAYERS)[number]> = Object.fromEntries(LAYERS.flatMap((l) => l.comps.map((c) => [c, l]))) as any;
export const compColor = (k: CompKey) => LAYER_OF[k].color;

export async function loadStyle(id: string): Promise<Style> {
  const r = await fetch(`/data/${id}/style.json`, { cache: "no-store" });
  return r.json();
}
export async function loadVideos(): Promise<VideoInfo[]> {
  try { const r = await fetch("/api/videos", { cache: "no-store" }); return await r.json(); } catch { return []; }
}

// ---------------------------------------------------------------- the library (saved components)
export type Saved = { uid: string; vid: string; source: string; handle: string; key: CompKey; comp: Comp; thumb: string | null; at: number };
const LS = "styleminer.library.v1";
export function readLib(): Saved[] {
  // items saved before 2026-11-20 say "colour"; the site says "color"
  try { return JSON.parse((localStorage.getItem(LS) || "[]").replace(/Colour/g, "Color").replace(/colour/g, "color")); } catch { return []; }
}
export function writeLib(x: Saved[]) {
  try { localStorage.setItem(LS, JSON.stringify(x)); } catch {}
  window.dispatchEvent(new Event("styleminer-lib"));
}
export const savedId = (vid: string, key: CompKey) => `${vid}:${key}`;

// ---------------------------------------------------------------- exports
export type Pick = Partial<Record<CompKey, Saved>>;

export function guideMarkdown(name: string, pick: Pick) {
  const keys = COMP_ORDER.filter((k) => pick[k]);
  const srcs = [...new Set(keys.map((k) => `${pick[k]!.source}${pick[k]!.handle ? ` (${pick[k]!.handle})` : ""}`))];
  let md = `# ${name}\n\nA visual style guide for short-form video (9:16, 1080x1920). Built with Visual Style Builder from ${srcs.length} reference video${srcs.length > 1 ? "s" : ""}: ${srcs.join(", ")}.\n`;
  md += `Every value below was measured from the pixels of the reference. Use it to make NEW footage in this style; do not copy the reference's content.\n\n`;
  md += `## How to use this\n- A human editor: follow each section's rules.\n- An AI editor (ChatGPT, Codex, an agent): treat the rules as the spec and the JSON block at the end as the parameters.\n\n`;
  keys.forEach((k, i) => {
    const s = pick[k]!; const c = s.comp;
    md += `## ${String(i + 1).padStart(2, "0")} ${c.title}\nFrom: ${s.source}${s.handle ? ` (${s.handle})` : ""}\n\n**${c.headline}**\n\n`;
    md += c.specs.map(([a, b]) => `- ${a}: ${b}`).join("\n") + "\n\nRules:\n" + c.rules.map((r) => `- ${r}`).join("\n") + "\n\n";
  });
  md += "## Parameters (JSON)\n\n```json\n" + JSON.stringify(guideJSON(name, pick), null, 2) + "\n```\n";
  return md;
}

export function guideJSON(name: string, pick: Pick) {
  const out: any = { style_guide: name, format: "9:16 1080x1920", made_with: "Visual Style Builder", components: {} };
  COMP_ORDER.forEach((k) => {
    const s = pick[k]; if (!s) return;
    const d = { ...s.comp.data };
    // keep the parameters, drop the long per-frame lists
    ["items", "lens", "curve", "runs", "cuts", "ys", "xs", "hs", "crops", "hist", "per5s"].forEach((x) => { if (Array.isArray(d[x]) && d[x].length > 12) d[x] = `${d[x].length} values`; });
    out.components[k] = { from: `${s.source}${s.handle ? ` ${s.handle}` : ""}`, headline: s.comp.headline, specs: Object.fromEntries(s.comp.specs), rules: s.comp.rules, data: d };
  });
  return out;
}

export function download(name: string, text: string | Blob, type = "text/plain") {
  const b = typeof text === "string" ? new Blob([text], { type }) : text;
  const u = URL.createObjectURL(b);
  const l = document.createElement("a"); l.href = u; l.download = name; l.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

async function dataURL(src: string): Promise<string | null> {
  try {
    const r = await fetch(src); const b = await r.blob();
    return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.readAsDataURL(b); });
  } catch { return null; }
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The board for Figma: an SVG with real text layers and the reference crops embedded (drag the file into Figma).
export async function guideSVG(name: string, pick: Pick) {
  const keys = COMP_ORDER.filter((k) => pick[k]);
  const CW = 600, GAP = 32, COLS = 3, PAD = 64;
  const cardH = 560;
  const rows = Math.ceil(keys.length / COLS);
  const Wd = PAD * 2 + COLS * CW + (COLS - 1) * GAP, Ht = 260 + rows * (cardH + GAP) + PAD;
  let body = "";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]; const s = pick[k]!; const c = s.comp; const col = compColor(k);
    const x = PAD + (i % COLS) * (CW + GAP), y = 220 + Math.floor(i / COLS) * (cardH + GAP);
    body += `<g id="${esc(c.title)}"><rect x="${x}" y="${y}" width="${CW}" height="${cardH}" rx="18" fill="#111015" stroke="${col}" stroke-opacity="0.45"/>`;
    body += `<text x="${x + 28}" y="${y + 44}" fill="${col}" font-family="JetBrains Mono" font-size="15" letter-spacing="2">${String(i + 1).padStart(2, "0")}  ${esc(c.title.toUpperCase())}</text>`;
    body += `<text x="${x + 28}" y="${y + 70}" fill="#8f8a83" font-family="JetBrains Mono" font-size="12">FROM ${esc((s.source + " " + s.handle).trim().toUpperCase())}</text>`;
    const words = c.headline.split(" "); let line = "", ly = y + 112; const lines: string[] = [];
    words.forEach((w) => { if ((line + " " + w).length > 36) { lines.push(line); line = w; } else line = (line + " " + w).trim(); }); lines.push(line);
    lines.slice(0, 3).forEach((l, j) => { body += `<text x="${x + 28}" y="${ly + j * 34}" fill="#f3eee6" font-family="Instrument Serif" font-size="30">${esc(l)}</text>`; });
    // visual strip: swatches or crops
    let vy = y + 230;
    const sw = swatchesOf(c);
    if (sw.length) {
      sw.slice(0, 6).forEach((h, j) => { body += `<rect x="${x + 28 + j * 92}" y="${vy}" width="80" height="80" rx="10" fill="${h}"/><text x="${x + 28 + j * 92}" y="${vy + 98}" fill="#8f8a83" font-family="JetBrains Mono" font-size="11">${h}</text>`; });
    } else {
      const imgs = imagesOf(c).slice(0, 4);
      for (let j = 0; j < imgs.length; j++) {
        const u = await dataURL(`/data/${s.vid}/${imgs[j]}`);
        if (u) body += `<image x="${x + 28 + j * 138}" y="${vy}" width="128" height="110" preserveAspectRatio="xMidYMid slice" href="${u}"/>`;
      }
    }
    c.specs.slice(0, 6).forEach(([a, b], j) => {
      const yy = y + 368 + j * 30;
      body += `<text x="${x + 28}" y="${yy}" fill="#8f8a83" font-family="Inter Tight" font-size="15">${esc(a)}</text><text x="${x + CW - 28}" y="${yy}" text-anchor="end" fill="#f3eee6" font-family="Inter Tight" font-size="15">${esc(b.slice(0, 40))}</text>`;
    });
    body += `</g>`;
  }
  const srcs = [...new Set(keys.map((k) => pick[k]!.source))].join(" · ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}" viewBox="0 0 ${Wd} ${Ht}">
<rect width="100%" height="100%" fill="#07070a"/>
<text x="${PAD}" y="${PAD + 18}" fill="#ff9a4d" font-family="JetBrains Mono" font-size="16" letter-spacing="3">STYLE GUIDE · ${keys.length} COMPONENTS</text>
<text x="${PAD}" y="${PAD + 92}" fill="#f3eee6" font-family="Instrument Serif" font-size="72">${esc(name)}</text>
<text x="${PAD}" y="${PAD + 132}" fill="#8f8a83" font-family="Inter Tight" font-size="18">From ${esc(srcs)}</text>
${body}</svg>`;
}

export function swatchesOf(c: Comp): string[] {
  const d = c.data || {};
  if (c.key === "grade") return [d.aroll?.shadows, d.aroll?.mids, d.aroll?.highlights, ...(d.palette || []).slice(0, 3).map((x: any) => x.hex)].filter(Boolean);
  if (c.key === "textcolor") return [d.main?.hex, d.highlight?.hex, ...(d.title_colors || []).slice(0, 1).map((x: any) => x.hex)].filter(Boolean);
  if (c.key === "set") return (d.palette || []).slice(0, 5).map((x: any) => x.hex);
  return [];
}
export function imagesOf(c: Comp): string[] {
  const d = c.data || {};
  if (c.key === "broll") return (d.items || []).filter((_: any, i: number, a: any[]) => i % Math.max(1, Math.floor(a.length / 6)) === 0).map((x: any) => x.file);
  if (c.key === "subtitles" || c.key === "typography") return (d.crops || []).map((x: any) => x.file);
  if (c.key === "person") return d.crops || [];
  if (c.key === "set" && d.image) return [d.image];
  return [];
}
