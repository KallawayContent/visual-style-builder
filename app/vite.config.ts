// The dev server + the local API: POST /api/analyze (a video -> the analyzer pipeline, streamed progress), GET /api/job
// (progress after a page reload), POST /api/fetch (download a public link with yt-dlp), GET /api/videos.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The Visual Style Builder folder = the parent of app/ (works wherever it is unzipped). The Python paths come from ../.env (setup.sh
// writes it) or the SM_PY / SM_RVM environment variables; the default is ../.venv (setup.sh makes it).
const SM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV: Record<string, string> = {};
try { fs.readFileSync(path.join(SM, ".env"), "utf8").split(/\r?\n/).forEach((l) => { const m = l.match(/^(\w+)="?([^"]*)"?$/); if (m) ENV[m[1]] = m[2]; }); } catch {}
const PY = process.env.SM_PY || ENV.SM_PY || (process.platform === "win32" ? path.join(SM, ".venv", "Scripts", "python.exe") : path.join(SM, ".venv", "bin", "python"));
// PORTABLE = not a Mac (Windows, Linux), or SM_PORTABLE=1 (the Windows path tested on a Mac): analyzer/prep.py + analyzer/portable.py
// (EasyOCR, OpenCV, Robust Video Matting, faster-whisper) instead of prep.sh and the Apple Vision tools
const PORTABLE = process.platform !== "darwin" || (process.env.SM_PORTABLE || ENV.SM_PORTABLE) === "1";
const CHILD_ENV = { ...process.env, ...(ENV.SM_WHISPER ? { SM_WHISPER: ENV.SM_WHISPER } : {}), ...(PORTABLE ? { SM_PORTABLE: "1" } : {}), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
const RVM = process.env.SM_RVM || ENV.SM_RVM || PY;

// POST /api/analyze  (body = the video file, header x-filename)
// Streams plain-text progress lines; the first is "job <id>", the last "done <id>". Every line also goes to data/ID/job.log,
// so a page that reloads in the middle finds the job again: GET /api/job?id=ID.
// The pipeline does not depend on the page: it runs to the end even when the page goes away.
const jobLog = (id: string) => path.join(SM, "data", id, "job.log");
function jobState(id: string) {
  const lp = jobLog(id), st = path.join(SM, "data", id, "style.json");
  const lines = fs.existsSync(lp) ? fs.readFileSync(lp, "utf8").split("\n").filter(Boolean) : [];
  const done = lines.some((l) => l === `done ${id}`) || (!lines.length && fs.existsSync(st));   // not "done rvm ..." (the matte step)
  const error = lines.find((l) => l.startsWith("error")) || null;
  const age = fs.existsSync(lp) ? Date.now() - fs.statSync(lp).mtimeMs : Infinity;
  return { id, lines: lines.slice(-80), done, error, running: !done && !error && age < 15 * 60 * 1000 };
}
function jobApi() {
  return {
    name: "job-api",
    configureServer(server: any) {
      server.middlewares.use("/api/lookup", (req: any, res: any) => {   // a dropped file analyzed before: {id} (the page hashes the file)
        const h = new URL(req.url, "http://x").searchParams.get("hash") || "";
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(/^[0-9a-f]{16}$/.test(h) ? { id: byHash(h) } : {}));
      });
      // POST /api/match (body = a dropped file): an analyzed video with the same bytes, or the same video in other bytes -> {id}
      server.middlewares.use("/api/match", (req: any, res: any) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          const buf = Buffer.concat(chunks);
          let id = byHash(sha16(buf));
          if (!id) {
            const tmp = path.join(SM, "uploads", `match_${Date.now()}.mp4`);
            try { fs.mkdirSync(path.dirname(tmp), { recursive: true }); fs.writeFileSync(tmp, buf); id = byContent(tmp); } catch {}
            try { fs.unlinkSync(tmp); } catch {}
          }
          res.end(JSON.stringify({ id: id || null }));
        });
      });
      server.middlewares.use("/api/job", (req: any, res: any) => {
        const id = new URL(req.url, "http://x").searchParams.get("id") || "";
        res.setHeader("Content-Type", "application/json");
        if (!/^[\w-]+$/.test(id) || !fs.existsSync(path.join(SM, "data", id))) { res.statusCode = 404; return res.end("{}"); }
        res.end(JSON.stringify(jobState(id)));
      });
    },
  };
}
function analyzeApi() {
  return {
    name: "analyze-api",
    configureServer(server: any) {
      server.middlewares.use("/api/analyze", (req: any, res: any) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        const name = decodeURIComponent(String(req.headers["x-filename"] || "upload.mp4")).replace(/[^\w.\- ]/g, "_");
        const handle = decodeURIComponent(String(req.headers["x-handle"] || "")).replace(/[^\w.@\-]/g, "").slice(0, 40);   // from a link (/api/fetch)
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          const idxPath = path.join(SM, "data", "index.json");
          const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf8")) : {};
          let logId = "";
          const say = (s: string) => {
            if (!res.writableEnded) { try { res.write(s + "\n"); } catch {} }
            if (logId) { try { fs.appendFileSync(jobLog(logId), s + "\n"); } catch {} }
          };
          if (idx[hash] && fs.existsSync(path.join(SM, "data", idx[hash], "analysis.json"))) {
            const cid = idx[hash];
            say(`cached ${cid}`);
            if (!fs.existsSync(path.join(SM, "data", cid, "style.json"))) {
              const p = spawn(PY, [path.join(SM, "analyzer", "style_deep.py"), cid], { env: CHILD_ENV });
              p.stdout.on("data", (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(say));
              p.on("close", () => { say(`done ${cid}`); res.end(); });
              return;
            }
            say(`done ${cid}`); return res.end();
          }
          const id = "u_" + hash;
          // the same file is already being analyzed (a second tab, or a reload that sent it again): follow that job, do not start a copy
          if (fs.existsSync(jobLog(id)) && jobState(id).running) { say(`job ${id}`); say("attach"); return res.end(); }
          fs.mkdirSync(path.join(SM, "data", id), { recursive: true });
          try { fs.writeFileSync(jobLog(id), ""); } catch {}
          logId = id;
          say(`job ${id}`);
          fs.mkdirSync(path.join(SM, "uploads"), { recursive: true });
          const src = path.join(SM, "uploads", `${hash}_${name}`);
          fs.writeFileSync(src, buf);
          fs.mkdirSync(path.join(SM, "data", id), { recursive: true });
          fs.writeFileSync(path.join(SM, "data", id, "meta.json"), JSON.stringify({ name: name.replace(/\.[^.]+$/, ""), ...(handle ? { handle } : {}), uploaded: Date.now() }));
          say(`saved ${name} ${(buf.length / 1e6).toFixed(1)} MB`);
          const run = (cmd: string, args: string[]) => new Promise<number>((ok) => {
            const p = spawn(cmd, args, { env: CHILD_ENV });
            const pipe = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(say);
            p.stdout.on("data", pipe); p.stderr.on("data", pipe);
            p.on("close", (code) => ok(code ?? 1));
          });
          (async () => {
            say("step prep");
            if (PORTABLE) {   // the person matte of prep.py is already Robust Video Matting: no second matte step
              if (await run(PY, [path.join(SM, "analyzer", "prep.py"), src, id])) { say("error prep"); return res.end(); }
              say("step matte");
            } else {
              if (await run("zsh", [path.join(SM, "analyzer", "prep.sh"), src, id])) { say("error prep"); return res.end(); }
              say("step matte");   // the sharper person matte (Robust Video Matting); on a failure Vision's matte stays
              await run(RVM, [path.join(SM, "analyzer", "matte_rvm.py"), id]);
            }
            if (await run(PY, [path.join(SM, "analyzer", "analyze.py"), id])) { say("error analyze"); return res.end(); }
            await run(PY, [path.join(SM, "analyzer", "repalette.py"), id]);
            say("step set");
            await run(PY, [path.join(SM, "analyzer", "set_plate.py"), id]);
            if (await run(PY, [path.join(SM, "analyzer", "style_deep.py"), id])) { say("error style"); return res.end(); }
            idx[hash] = id; fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
            say(`done ${id}`); res.end();
          })().catch((e) => { say(`error ${e}`); res.end(); });
        });
      });
    },
  };
}


// ---- a video that was analyzed before. 1. the same bytes: data/index.json (sha1 -> id). 2. the same video in other bytes (a link
// downloads another encoding than the file dropped before): the same length (the first 60 s) + the same pictures at two moments
// (36 x 64 grey frames, mean difference under 14). The oldest visible match wins.
const sha16 = (buf: Buffer) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
function byHash(hash: string): string | null {
  try { const idx = JSON.parse(fs.readFileSync(path.join(SM, "data", "index.json"), "utf8")); const id = idx[hash]; return id && fs.existsSync(path.join(SM, "data", id, "style.json")) ? id : null; } catch { return null; }
}
const VF = "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,scale=36:64,format=gray";
function grey(file: string, t: number): Buffer | null {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-vf", VF, "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
  return r.status === 0 && r.stdout && r.stdout.length === 36 * 64 ? r.stdout : null;
}
function durOf(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(String(r.stdout || "")) || 0;
}
function byContent(file: string): string | null {
  const full = durOf(file); if (!full) return null;
  const d = Math.min(60, full);
  const dir = path.join(SM, "data"); const cands: { id: string; hidden: boolean; at: number }[] = [];
  for (const id of fs.readdirSync(dir)) {
    const st = path.join(dir, id, "style.json"); if (!fs.existsSync(st)) continue;
    let dur = 0; try { dur = JSON.parse(fs.readFileSync(st, "utf8")).duration; } catch {}
    if ((Math.abs(dur - d) > 0.25 && Math.abs(dur - full) > 0.25) || !fs.existsSync(path.join(dir, id, "w.mp4"))) continue;
    let meta: any = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, id, "meta.json"), "utf8")); } catch {}
    cands.push({ id, hidden: !!meta.hidden, at: meta.uploaded || fs.statSync(st).mtimeMs });
  }
  cands.sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.at - b.at);
  const ts = [Math.min(1.5, d / 3), d * 0.6];
  const mine = ts.map((t) => grey(file, t)); if (mine.some((x) => !x)) return null;
  for (const c of cands) {
    const theirs = ts.map((t) => grey(path.join(dir, c.id, "w.mp4"), t));
    const ok = theirs.every((x, k) => { if (!x) return false; let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - mine[k]![i]); return s / x.length < 14; });
    if (ok) return c.id;
  }
  return null;
}

// POST /api/fetch  {url}  -> the video file of a public link. yt-dlp, ANONYMOUS (no cookies: Instagram and TikTok flag logged-in tool traffic), one download at a time,
// H.264 first (Apple's text reader cannot open VP9), at least GAP seconds apart (many downloads in a row get blocked), a link that was downloaded before is served from uploads/links/ again.
// The answer is the file itself (headers x-filename, x-handle); the page then sends it to /api/analyze like a dropped file.
function fetchApi() {
  const GAP = 8;
  let busy = false, last = 0;
  const dir = () => path.join(SM, "uploads", "links");
  const key = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\.|^m\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch { return u; } };
  return {
    name: "fetch-api",
    configureServer(server: any) {
      server.middlewares.use("/api/fetch", (req: any, res: any) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        let body = "";
        req.on("data", (c: Buffer) => { body += c; });
        req.on("end", () => {
          const fail = (code: number, msg: string) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: msg })); };
          let url = "";
          try { url = String(JSON.parse(body).url || "").trim(); } catch {}
          if (!/^https?:\/\/[^\s]+$/i.test(url)) return fail(400, "That is not a link. Paste the full address (https://...).");
          fs.mkdirSync(dir(), { recursive: true });
          const cacheP = path.join(dir(), "links.json");
          const cache = fs.existsSync(cacheP) ? JSON.parse(fs.readFileSync(cacheP, "utf8")) : {};
          const known = (e: any): string | null => {   // the link's video was analyzed before: its id
            if (e.id && fs.existsSync(path.join(SM, "data", e.id, "style.json"))) return e.id;
            const id = byContent(e.file) || byHash(sha16(fs.readFileSync(e.file)));
            if (id) { e.id = id; cache[key(url)] = e; fs.writeFileSync(cacheP, JSON.stringify(cache, null, 1)); }
            return id;
          };
          const send = (e: any) => {
            const id = known(e);
            if (id) { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ id, handle: e.handle || "" })); }
            res.setHeader("Content-Type", "video/mp4");
            res.setHeader("x-filename", encodeURIComponent(e.name + ".mp4"));
            res.setHeader("x-handle", encodeURIComponent(e.handle || ""));
            res.setHeader("x-cached", e.cached ? "1" : "0");
            fs.createReadStream(e.file).pipe(res);
          };
          const hit = cache[key(url)];
          if (hit && fs.existsSync(hit.file)) return send({ ...hit, cached: true });
          if (busy) return fail(429, "Another link is downloading. Try again in a few seconds.");
          const wait = Math.ceil(GAP - (Date.now() - last) / 1000);
          if (wait > 0) return fail(429, `Wait ${wait} s before the next link (too many downloads in a row get blocked).`);
          busy = true;
          const out = path.join(dir(), `${Date.now()}`);
          const args = ["--no-playlist", "--no-warnings", "--max-filesize", "400M",
            "-f", "bv*[vcodec^=avc1][height<=1920]+ba[ext=m4a]/b[vcodec^=avc1]/bv*[ext=mp4][height<=1920]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4",
            "-o", out + ".%(ext)s", "--print", "after_move:%(filepath)s\t%(channel|uploader_id|uploader|)s\t%(title|id)s", url];
          // a Mac: Homebrew's yt-dlp; portable: the yt-dlp of the Python environment (pip)
          const p = PORTABLE ? spawn(PY, ["-m", "yt_dlp", ...args], { env: CHILD_ENV })
            : spawn("yt-dlp", args, { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` } });
          let so = "", se = "";
          const timer = setTimeout(() => p.kill("SIGKILL"), 180000);
          p.stdout.on("data", (d: Buffer) => { so += d; });
          p.stderr.on("data", (d: Buffer) => { se += d; });
          p.on("error", () => { se += "yt-dlp is not installed (brew install yt-dlp / pip install yt-dlp)"; });
          p.on("close", (code) => {
            clearTimeout(timer); busy = false; last = Date.now();
            const line = so.trim().split("\n").filter(Boolean).pop() || "";
            const [file, who, title] = line.split("\t");
            if (code !== 0 || !file || !fs.existsSync(file)) {
              const why = (se.match(/ERROR: (.*)/) || [])[1] || se.trim().split("\n").pop() || "unknown error";
              const hint = /login|private|rate|429|403|sign in|cookies/i.test(why) ? " The video may be private, or the site limits downloads: try again in a minute, or download it and drop the file." : "";
              return fail(502, `The link did not download: ${why.slice(0, 200)}.${hint}`);
            }
            const handle = who ? (who.startsWith("@") ? who : "@" + who) : "";
            const name = (title || "video").replace(/[\r\n]+/g, " ").replace(/[^\w.\- '&]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "video";
            const e = { file, name, handle, url, at: Date.now() };
            cache[key(url)] = e; fs.writeFileSync(cacheP, JSON.stringify(cache, null, 1));
            send(e);
          });
        });
      });
    },
  };
}

// GET /api/videos: every analyzed video that has a style.json
function videosApi() {
  return {
    name: "videos-api",
    configureServer(server: any) {
      server.middlewares.use("/api/videos", (_req: any, res: any) => {
        const dir = path.join(SM, "data");
        const out: any[] = [];
        for (const id of fs.readdirSync(dir)) {
          const st = path.join(dir, id, "style.json");
          if (!fs.existsSync(st)) continue;
          let meta: any = {};
          try { meta = JSON.parse(fs.readFileSync(path.join(dir, id, "meta.json"), "utf8")); } catch {}
          if (meta.hidden) continue;   // an old test cut (kept on disk)
          const s = JSON.parse(fs.readFileSync(st, "utf8"));
          out.push({ id, name: meta.name || id, handle: meta.handle || "", duration: s.duration, thumb: s.thumb, time: meta.uploaded || fs.statSync(st).mtimeMs, demo: !!meta.demo });
        }
        out.sort((a, b) => (b.demo ? 1 : 0) - (a.demo ? 1 : 0) || b.time - a.time);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      });
    },
  };
}

export default defineConfig({ plugins: [react(), analyzeApi(), videosApi(), jobApi(), fetchApi()], server: { fs: { allow: [SM] } } });
