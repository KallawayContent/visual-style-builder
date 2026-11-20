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

Everything runs on your own computer. No account, no paid API, no upload to a server.

## Requirements

- **macOS** (Apple Silicon recommended). The person cut-out and the text reading use Apple's Vision framework, so this
  version does not run on Windows or Linux.
- About 3 GB of free disk space (about 1.5 GB with `LITE=1`).
- An internet connection for the setup.

## Set it up with an AI agent (easiest)

Open Codex (or any coding agent that can run commands on your Mac) in an empty folder and paste:

```
Clone https://github.com/samuelcodinggod/visual-style-builder and follow its AGENT_SETUP.md to install it and open the site.
```

## Set it up by hand

```sh
git clone https://github.com/samuelcodinggod/visual-style-builder.git
cd visual-style-builder
./setup.sh        # 5-15 minutes the first time
./start.sh        # opens http://127.0.0.1:5190
```

Options: `LITE=1 ./setup.sh` skips PyTorch (smaller, softer person cut-out). `WHISPER_MODEL=large-v3-turbo ./setup.sh`
downloads a larger speech model for more exact word timing.

## How it works

1. `analyzer/prep.sh`: scales the video to 540x960 at 30 fps, reads the on-screen text (Apple Vision), cuts out the person
   (Apple Vision), and transcribes the words with timings (whisper.cpp).
2. `analyzer/matte_rvm.py`: a sharper person cut-out with Robust Video Matting (skipped in the lite setup).
3. `analyzer/analyze.py`: cuts, layout over time, B-roll (pictures and clips over or around the speaker), captions, the palette,
   and one packed 3 x 2 video that holds every layer in sync.
4. `analyzer/style_deep.py`: the 11 style components in `data/ID/style.json`, with crops in `data/ID/parts/`.
5. `app/`: the site (Vite + React + Three.js). `app/vite.config.ts` also holds the local API: upload, progress, link download.

A pasted link is downloaded with yt-dlp, without any login, one at a time. Only analyze videos you have the right to use.

## License

MIT
