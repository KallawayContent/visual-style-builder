# Visual Style Builder

Drop in a short-form video (or paste an Instagram, TikTok or YouTube link) and see its visual style taken apart: the video
splits into 7 layers in 3D, and every part of the style is measured from the real pixels.

- **Layout & format**: split screen, full-frame speaker, full-screen B-roll, and how much of the video is each
- **B-roll & where it sits**: every picture or clip that is not the speaker, what kind it is, and where it sits (behind, beside or in front of the speaker)
- **Subtitles & typography**: words on screen at a time, case, position, weight, size, outline
- **Pace & cuts**: shot lengths, cuts on spoken words
- **Motion & transitions**: punch-ins, flashes, camera moves, how captions come in
- **Person framing**: shot size, eye line, headroom
- **Text color**, **Set & lighting**, **Color grade**

Save the parts you like from many videos, combine them into your own styles (Style 1, Style 2 ...), and export a style guide:
a 9:16 poster + one page per part (PNG), a Markdown guide to paste into ChatGPT, or JSON.

Everything runs on your own computer (Mac or Windows). No account, no paid API, no upload to a server.

## Requirements

| | Mac | Windows 10 / 11 |
|---|---|---|
| Analyzer | Apple Vision (person cut-out, text, faces, cards) + Robust Video Matting + faster-whisper | Free cross-platform tools: Robust Video Matting, EasyOCR, OpenCV, faster-whisper |
| Install | the one line below (needs nothing else) | the one line below (winget installs Python, Node.js, FFmpeg) |
| Start | "Start Visual Style Builder" on the Desktop, or `./start.sh` | `start.cmd` |
| Disk space | about 3-4 GB (`LITE=1`: 1.5 GB) | about 3 GB |
| Speed (a 47 s video) | about 3 minutes | about 3-6 minutes (faster with an NVIDIA graphics card) |

Both versions give the same 11 parts. The Mac version is the reference; the Windows version was checked against it on the same
videos (same results on most parts; it names B-roll kinds less exactly, because Apple's image labels have no free equivalent).
The Windows version was tested on a Mac in its portable mode, not yet on a Windows computer: if the setup stops, the AI agent
can fix it with AGENT_SETUP.md. Linux works like Windows (portable mode) with your own package manager.

## Install it (one line, nothing else needed)

**Mac** (macOS 12 or newer): open the **Terminal** app (Cmd+Space, type Terminal, press Return), paste this line, press Return:

```sh
curl -fsSL https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.sh | zsh
```

**Windows 10 / 11**: open **PowerShell** (Start menu, type PowerShell, press Enter), paste this line, press Enter:

```powershell
irm https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.ps1 | iex
```

It takes 5-15 minutes the first time, then the site opens in your browser. Keep the window open while you use it. Next time on
a Mac, double-click **Start Visual Style Builder** on the Desktop; on Windows, double-click `start.cmd` in the
`visual-style-builder` folder of your user folder.

The Mac install needs no git, no Homebrew, no Xcode tools and no password: it brings its own Python, Node.js and FFmpeg
into the folder `~/visual-style-builder`. To remove everything, delete that folder.

## Or let an AI agent install it

Open the **Codex app** (or another agent that can run commands on your computer; a chat window cannot) and paste:

```
Install the Visual Style Builder from https://github.com/KallawayContent/visual-style-builder and open it. Follow its AGENT_SETUP.md (on a Mac: no git, use the install line).
```

## Options

- Mac: `LITE=1 ./setup.sh` skips PyTorch (smaller, softer person cut-out). `WHISPER_MODEL=small.en ./setup.sh` uses a bigger
  speech model for more exact word timing. Run them in `~/visual-style-builder`.
- Developers: `git clone` works too; then `./setup.sh` and `./start.sh` (Mac) or `setup.cmd` and `start.cmd` (Windows).

## How it works

1. `analyzer/prep.sh` (Mac) / `analyzer/prep.py` (Windows): scales the video to 540x960 at 30 fps, reads the on-screen text (Apple Vision), cuts out the person
   (Apple Vision; on Windows `analyzer/portable.py`), and transcribes the words with timings (whisper.cpp / faster-whisper).
2. `analyzer/matte_rvm.py`: a sharper person cut-out with Robust Video Matting (skipped in the lite setup).
3. `analyzer/analyze.py`: cuts, layout over time, B-roll (pictures and clips over or around the speaker), captions, the palette,
   and one packed 3 x 2 video that holds every layer in sync.
4. `analyzer/style_deep.py`: the 11 style components in `data/ID/style.json`, with crops in `data/ID/parts/`.
5. `app/`: the site (Vite + React + Three.js). `app/vite.config.ts` also holds the local API: upload, progress, link download.

A pasted link is downloaded with yt-dlp, without any login, one at a time. Only analyze videos you have the right to use.

## License

MIT
