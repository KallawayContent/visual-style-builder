# AGENT_SETUP.md: instructions for an AI coding agent

You are installing **Visual Style Builder** for the user on their Mac and opening it. The code is complete and works.
**Do not rewrite, refactor or "improve" the code.** Your job is the installation. Change a file only to fix an install
problem on this computer, and tell the user what you changed.

## 0. Check the computer

- Run `uname` and `sw_vers`. If this is not macOS, STOP and tell the user: "This version runs on macOS only, because it uses
  Apple's Vision framework." Do not try to port it.
- Check the free disk space (`df -h ~`). The full setup needs about 3 GB; `LITE=1` needs about 1.5 GB.

## 1. Get the code

If you are not already inside the repository: `git clone https://github.com/samuelcodinggod/visual-style-builder.git`
and `cd visual-style-builder`.

## 2. Run the setup

Run `./setup.sh` from the repository folder. It prints 8 numbered steps and takes 5-15 minutes the first time
(PyTorch is about 1 GB). It is safe to run again; it skips finished steps.

It can stop for two things only the user can do. Tell the user exactly what to do, wait, then run `./setup.sh` again:
- **Apple command line tools missing**: the user runs `xcode-select --install` and clicks Install in the window.
- **Homebrew missing**: the user installs it from https://brew.sh (it asks for their password).

Before a large download that the user did not ask for, ask first:
- `WHISPER_MODEL=large-v3-turbo` (1.6 GB) is only for more exact word timing. The default model is fine.

If PyTorch does not install, run `LITE=1 ./setup.sh` and tell the user the person cut-out will be a little softer.

## 3. Start the site

Run `./start.sh`. It serves http://127.0.0.1:5190 and opens it in the browser. Keep it running (run it in the
background, or tell the user to keep the terminal open). If port 5190 is taken: `PORT=5191 ./start.sh`.

## 4. Check that it works

Tell the user to test it:
1. Paste a public Instagram, TikTok or YouTube Shorts link into "or paste a link", or drop an MP4 / MOV file on the drop zone.
2. The progress list ticks through its steps. A new video takes 1-4 minutes.
3. The video scans, then splits into 7 layers. Click a layer, press "+ Save", then open "Saved styles" at the top right.

## Troubleshooting

| What happens | What to do |
|---|---|
| "The link did not download" | `brew upgrade yt-dlp`, then try again. Private videos and some rate limits cannot be downloaded: download the file and drop it instead. |
| "Wait N s before the next link" | Normal: links download one at a time, 8 s apart, so the sites do not block them. |
| The progress stops with "error prep" | Check `data/<id>/job.log`. Usually ffmpeg or a Swift tool is missing: run `./setup.sh` again. |
| "Sharpening the cut-out" fails | Fine: the Apple Vision cut-out is used. The full setup's step 7 downloads the sharper model. |
| The page is blank | Run `cd app && npx tsc --noEmit -p .` and read the error; make sure `./start.sh` is still running. |
| A Swift tool does not build | Run `xcode-select --install` (or update Xcode), then `./setup.sh` again. |

## Where things are

- `data/<id>/`: everything measured for one video (`style.json` is the result). `uploads/`: the original files.
- `analyzer/`: the measuring pipeline (Python, shell, Swift). `app/`: the site and its local API (`app/vite.config.ts`).
- Saved parts and styles live in the browser (localStorage), not on disk.
