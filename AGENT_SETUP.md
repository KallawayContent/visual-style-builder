# AGENT_SETUP.md: instructions for an AI coding agent

You are installing **Visual Style Builder** for the user on their computer and opening it. The code is complete and works.
**Do not rewrite, refactor or "improve" the code.** Your job is the installation. Change a file only to fix an install
problem on this computer, and tell the user what you changed.

## 0. Which computer is this?

Check the operating system first, then follow ONE section below:
- **macOS** -> section A (the Apple Vision version, `setup.sh`).
- **Windows 10 / 11** -> section B (the portable version, `setup.ps1`).
- **Linux** -> section B's steps by hand: `python3 -m venv .venv`, `.venv/bin/pip install -r requirements-portable.txt`,
  `.venv/bin/python analyzer/portable.py warmup`, `cd app && npm ci`, `ln -s ../../data app/public/data`, then
  `cd app && npx vite --port 5190 --host 127.0.0.1`. Needs ffmpeg and Node 18+ from the package manager.

Free disk space needed: about 3 GB.

Get the code if you are not inside it already: `git clone https://github.com/samuelcodinggod/visual-style-builder.git`, then
`cd visual-style-builder`.

## A. macOS

1. Run `./setup.sh`. It prints 8 numbered steps and takes 5-15 minutes the first time (PyTorch is about 1 GB). It is safe to
   run again; it skips finished steps. It can stop for two things only the user can do. Tell the user exactly what to do, wait,
   then run `./setup.sh` again:
   - **Apple command line tools missing**: the user runs `xcode-select --install` and clicks Install in the window.
   - **Homebrew missing**: the user installs it from https://brew.sh (it asks for their password).
2. If PyTorch does not install: `LITE=1 ./setup.sh` (the person cut-out is then a little softer). Ask before the optional large
   speech model (`WHISPER_MODEL=large-v3-turbo`, 1.6 GB); the default model is fine.
3. Start: `./start.sh` (http://127.0.0.1:5190; it opens the browser). Keep it running. Port taken: `PORT=5191 ./start.sh`.

## B. Windows 10 / 11

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1` from the repository folder (the user can also
   double-click `setup.cmd`). 7 numbered steps, 10-20 minutes the first time (about 2 GB of Python libraries + the models).
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

## Check that it works (both)

Tell the user to test it:
1. Paste a public Instagram, TikTok or YouTube Shorts link into "or paste a link", or drop an MP4 / MOV file on the drop zone.
2. The progress list ticks through its steps. A new video takes 1-6 minutes. A video analyzed before opens at once.
3. The video scans, then splits into 7 layers. Click a layer, press "+ Save", then open "Saved styles" at the top right.

## Troubleshooting

| What happens | What to do |
|---|---|
| "The link did not download" | Mac: `brew upgrade yt-dlp`. Windows: `.venv\Scripts\python.exe -m pip install -U yt-dlp`. Private videos and some rate limits cannot be downloaded: download the file and drop it instead. |
| "Wait N s before the next link" | Normal: links download one at a time, 8 s apart, so the sites do not block them. |
| The progress stops with "error prep" | Read `data/<id>/job.log` for the error. Mac: run `./setup.sh` again. Windows: run `.venv\Scripts\python.exe analyzer\prep.py <video> test` to see the full error. |
| CERTIFICATE_VERIFY_FAILED on a download | `pip install -U certifi` in the .venv (the analyzer uses certifi's certificates). |
| The page is blank | Run `cd app && npx tsc --noEmit -p .` and read the error; make sure the start script is still running. |
| A Swift tool does not build (Mac) | `xcode-select --install` (or update Xcode), then `./setup.sh` again. |

## Where things are

- `data/<id>/`: everything measured for one video (`style.json` is the result). `uploads/`: the original files.
- `analyzer/`: the measuring pipeline (Python, shell, Swift; `portable.py` = the cross-platform tools). `app/`: the site and its
  local API (`app/vite.config.ts`). Saved parts and styles live in the browser (localStorage), not on disk.
