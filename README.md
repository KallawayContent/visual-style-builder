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
| Analyzer | Apple Vision (person cut-out, text, faces, cards) + Robust Video Matting + whisper.cpp | Free cross-platform tools: Robust Video Matting, EasyOCR, OpenCV, faster-whisper |
| Install | `./setup.sh` (Homebrew) | `setup.cmd` (winget) |
| Start | `./start.sh` | `start.cmd` |
| Disk space | about 3 GB (`LITE=1`: 1.5 GB) | about 3 GB |
| Speed (a 47 s video) | about 3 minutes | about 3-6 minutes (faster with an NVIDIA graphics card) |

Both versions give the same 11 parts. The Mac version is the reference; the Windows version was checked against it on the same
videos (same results on most parts; it names B-roll kinds less exactly, because Apple's image labels have no free equivalent).
The Windows version was tested on a Mac in its portable mode, not yet on a Windows computer: if the setup stops, the AI agent
can fix it with AGENT_SETUP.md. Linux works like Windows (portable mode) with your own package manager.

## Set it up with an AI agent (easiest)

Open Codex (or any coding agent that can run commands on your computer) in an empty folder and paste:

```
Clone https://github.com/KallawayContent/visual-style-builder and follow its AGENT_SETUP.md to install it and open the site.
```

## Set it up by hand

Mac:

```sh
git clone https://github.com/KallawayContent/visual-style-builder.git
cd visual-style-builder
./setup.sh        # 5-15 minutes the first time
./start.sh        # opens http://127.0.0.1:5190
```

Options: `LITE=1 ./setup.sh` skips PyTorch (smaller, softer person cut-out). `WHISPER_MODEL=large-v3-turbo ./setup.sh`
downloads a larger speech model for more exact word timing.

Windows: download the repository (Code > Download ZIP, or `git clone`), open the folder, double-click **setup.cmd**
(10-20 minutes the first time), then double-click **start.cmd** (it opens http://127.0.0.1:5190; keep its window open).

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
