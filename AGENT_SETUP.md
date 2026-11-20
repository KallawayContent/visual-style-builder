# AGENT_SETUP.md: instructions for an AI coding agent

You are installing **Visual Style Builder** for the user on their computer and opening it. The code is complete and works.
**Do not rewrite, refactor or "improve" the code.** Your job is the installation. Change a file only to fix an install
problem on this computer, and tell the user what you changed.

## If you cannot run commands on the user's computer

A chat app (a chat window with no terminal) cannot install this. Do not explain git, Homebrew or
developer tools. Give the user exactly ONE line and tell them where to paste it:
- **Mac**: open the Terminal app (Cmd+Space, type Terminal, press Return), paste this line, press Return:
  `curl -fsSL https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.sh | zsh`
- **Windows**: open PowerShell (Start menu, type PowerShell, press Enter), paste this line, press Enter:
  `irm https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.ps1 | iex`

It takes 5-15 minutes and opens the site in the browser by itself. Or tell the user to use the Codex app (or another agent
that can run commands on their computer) and paste the same request there.

## 0. Which computer is this?

Check the operating system first, then follow ONE section below:
- **macOS** -> section A.
- **Windows 10 / 11** -> section B (the portable version, `setup.ps1`).
- **Linux** -> section B's steps by hand: `python3 -m venv .venv`, `.venv/bin/pip install -r requirements-portable.txt`,
  `.venv/bin/python analyzer/portable.py warmup`, `cd app && npm ci`, `ln -s ../../data app/public/data`, then
  `cd app && npx vite --port 5190 --host 127.0.0.1`. Needs ffmpeg and Node 18+ from the package manager.

Free disk space needed: about 4 GB.

**Do not use `git clone` on a Mac**, and do not run `python3`, `git`, `brew` or `xcode-select` there. On a Mac with no
developer tools, `git` and `python3` open Apple's "install command line tools" window and stop. The installers below need
none of them: they download the code with `curl` and bring their own Python, Node.js and FFmpeg.

## A. macOS (12 or newer)

1. Install: `curl -fsSL https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.sh | NO_START=1 zsh`
   It downloads the code into `~/visual-style-builder` and runs `setup.sh` there (7 numbered steps, 5-15 minutes the first
   time; PyTorch is about 1 GB). It needs no password and no user action. It needs internet access (allow network access if
   your sandbox asks). If you are already inside a copy of this repository, run `./setup.sh` instead. Both are safe to run again.
2. If PyTorch does not install: `LITE=1 ./setup.sh` (the person cut-out is then a little softer). Intel Macs get the lite
   version by themselves.
3. Start: `open ~/visual-style-builder/"Start Visual Style Builder.command"`. It opens a Terminal window that runs the site
   (http://127.0.0.1:5190) and opens the browser. The site runs only while that window is open. Tell the user: next time,
   double-click "Start Visual Style Builder" on the Desktop. (Or run `./start.sh` in a terminal that stays open.)

## B. Windows 10 / 11

1. Install: `$env:NO_START=1; irm https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.ps1 | iex`
   in PowerShell (no git needed; the code goes into `%USERPROFILE%\visual-style-builder`). Inside a copy of the repository:
   `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1` (the user can also double-click `setup.cmd`). 7 numbered steps, 10-20 minutes the first time (about 2 GB of Python libraries + the models).
   It installs Python 3.12, Node.js LTS and FFmpeg with winget when they are missing.
   - **winget missing**: the user installs "App Installer" from the Microsoft Store.
   - **"... is still not found" after an install**: a new PATH needs a new window. Open a new terminal and run the setup again.
   - **A pip error** for one library: read it; usually `py -3.12` is needed (not 3.13+), or the Microsoft C++ runtime
     (`winget install Microsoft.VCRedist.2015+.x64`). Then run the setup again.
2. NVIDIA graphics card (optional, 3-5x faster): after the setup, ask the user, then
   `.venv\Scripts\python.exe -m pip install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu124`.
3. Start: `powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1` (or double-click `start.cmd`). It serves
   http://127.0.0.1:5190 and opens the browser. Keep it running. Port taken: set `$env:PORT=5191` first.

How the Windows version differs (do not try to "fix" these, they are by design): `analyzer/prep.py` + `analyzer/portable.py`
replace `prep.sh` and the Swift tools (`*.swift` are Mac-only and are not built on Windows); the server picks them by itself
(`process.platform`). The on-screen text is read 5 times a second (10 on a Mac). B-roll kinds are named from flatness + faces.

## Analyze videos from code (for an agent doing a bigger task)

The user may ask you to analyze many videos (for example the top videos of their niche) and use the results. The site has a
local API; start it first (section A or B, step "Start") and keep it running. Base URL: http://127.0.0.1:5190

1. **A link:** `POST /api/fetch` with JSON `{"url": "<Instagram / TikTok / YouTube link>"}`.
   - Answer JSON `{"id": "<id>"}` = this video was analyzed before: go to step 3.
   - Answer `video/mp4` = the downloaded video (headers `x-filename`, `x-handle`): send it to step 2.
   - Status 429 = wait the seconds it says (one download at a time, 8 s apart, so the sites do not block it). Other errors = a
     private or blocked video: skip it or ask the user for the file.
2. **A file:** `POST /api/analyze` with the video file as the body and the headers `x-filename` (URL-encoded name) and
   `x-handle` (optional, e.g. `@creator`). The answer streams text lines; the last one is `done <id>` (or `error ...`).
   1-4 minutes for a new video. If the stream breaks, poll `GET /api/job?id=<id>` until `"done": true`.
   Example: `curl -s -N -X POST --data-binary @video.mp4 -H "x-filename: video.mp4" http://127.0.0.1:5190/api/analyze | tail -1`
3. **Read the result:** `data/<id>/style.json` = the 11 parts (`components.<key>.headline`, `.specs`, `.rules`, `.data`; keys:
   layout, pace, person, broll, broll_framing, grade, subtitles, typography, textcolor, motion, set).
   `data/<id>/analysis.json` = the timeline: `words` (each spoken word with `t0`, `t1`), `captions` (on-screen text with `t0`,
   `t1`, `text`, `kind` caption/title, `box` [x, y, w, h] from the top left, 0-1), `cuts` (frame numbers, `fps`), `shots`,
   `layout_runs`, `inserts` (B-roll pictures over the speaker: `t0`, `t1`, `rect`, `where`). For a HOOK, read everything with
   `t0` under 3 seconds. Crops of the parts are in `data/<id>/parts/`.
4. Analyses are also shown in the site under "Previous videos", so the user can open each one and save the parts they like.

## Check that it works (both)

Tell the user to test it:
1. Paste a public Instagram, TikTok or YouTube Shorts link into "or paste a link", or drop an MP4 / MOV file on the drop zone.
2. The progress list ticks through its steps. A new video takes 1-6 minutes. A video analyzed before opens at once.
3. The video scans, then splits into 7 layers. Click a layer, press "+ Save", then open "Saved styles" at the top right.

## Troubleshooting

| What happens | What to do |
|---|---|
| "The link did not download" | Mac: `.venv/bin/python -m pip install -U yt-dlp` (or `.tools/bin/uv pip install --python .venv/bin/python -U yt-dlp`). Windows: `.venv\Scripts\python.exe -m pip install -U yt-dlp`. Private videos and some rate limits cannot be downloaded: download the file and drop it instead. |
| "Wait N s before the next link" | Normal: links download one at a time, 8 s apart, so the sites do not block them. |
| The progress stops with "error prep" | Read `data/<id>/job.log` for the error. Mac: run `./setup.sh` again. Windows: run `.venv\Scripts\python.exe analyzer\prep.py <video> test` to see the full error. |
| CERTIFICATE_VERIFY_FAILED on a download | `pip install -U certifi` in the .venv (the analyzer uses certifi's certificates). |
| The page is blank | Run `cd app && npx tsc --noEmit -p .` and read the error; make sure the start script is still running. |
| "FFmpeg or an Apple Vision tool does not run" (Mac) | macOS 12 or newer is needed. Delete `.tools/` and run `./setup.sh` again. The tools come from the GitHub release `mac-tools-v1` of this repository (SHA-256 checked). |
| Apple's "install command line tools" window opened (Mac) | Something ran `git`, `python3` or `xcode-select`. Close the window (Cancel) and use the installer line of section A instead. |

## Where things are

- `data/<id>/`: everything measured for one video (`style.json` is the result). `uploads/`: the original files.
- `analyzer/`: the measuring pipeline (Python, shell, Swift; `portable.py` = the cross-platform tools). `app/`: the site and its
  local API (`app/vite.config.ts`). Saved parts and styles live in the browser (localStorage), not on disk.
