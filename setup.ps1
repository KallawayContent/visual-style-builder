# Visual Style Builder: one-time setup on Windows 10 / 11. Safe to run again: every step skips what is already done.
# Run it by double-clicking setup.cmd, or:  powershell -ExecutionPolicy Bypass -File setup.ps1
# Windows uses the PORTABLE analyzer (analyzer/portable.py): EasyOCR, OpenCV, Robust Video Matting, faster-whisper instead of the
# Apple Vision tools of the Mac version. About 3 GB. WHISPER_MODEL=small.en (or another faster-whisper model) for better word timing.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Root = (Get-Location).Path
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    ok $m" -ForegroundColor Green }
function Fail($m) { Write-Host "`nSETUP STOPPED: $m`n" -ForegroundColor Red; exit 1 }
function Has($c)  { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

Step "1/7 This computer"
Ok ("Windows " + [Environment]::OSVersion.Version + ", " + $env:PROCESSOR_ARCHITECTURE)

Step "2/7 winget (the Windows package installer)"
if (-not (Has "winget")) { Fail "winget is missing. Install 'App Installer' from the Microsoft Store, then run setup.cmd again." }
Ok "winget"

Step "3/7 Programs: Python 3.12, Node.js, FFmpeg"
function Find-Python {
  foreach ($v in @("3.12", "3.11", "3.13")) {
    if (Has "py") { $p = (& py "-$v" -c "import sys; print(sys.executable)" 2>$null); if ($LASTEXITCODE -eq 0 -and $p) { return $p.Trim() } }
  }
  if (Has "python") { $p = (& python -c "import sys; print(sys.executable if (3,10) <= sys.version_info[:2] <= (3,13) else '')" 2>$null); if ($p) { return $p.Trim() } }
  return $null
}
$Py = Find-Python
if (-not $Py) {
  Write-Host "    installing Python 3.12 ..."
  winget install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
  Refresh-Path; $Py = Find-Python
}
if (-not $Py) { Fail "Python 3.12 did not install. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run setup.cmd again." }
Ok "Python: $Py"
foreach ($p in @(@{ id = "OpenJS.NodeJS.LTS"; cmd = "node" }, @{ id = "Gyan.FFmpeg"; cmd = "ffmpeg" })) {
  if (-not (Has $p.cmd)) {
    Write-Host ("    installing " + $p.id + " ...")
    winget install --id $p.id -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
    Refresh-Path
  }
  if (-not (Has $p.cmd)) { Fail ($p.cmd + " is still not found. Close this window, open a new one (so the new PATH loads), and run setup.cmd again.") }
  Ok $p.cmd
}
if (-not (Has "ffprobe")) { Fail "ffprobe is not found (it comes with FFmpeg). Open a new window and run setup.cmd again." }

Step "4/7 Python environment (.venv) + the analyzer's libraries (PyTorch, EasyOCR, faster-whisper, yt-dlp: about 2 GB)"
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) { & $Py -m venv .venv; if ($LASTEXITCODE) { Fail "python -m venv failed." } }
& $VPy -m pip install -q --upgrade pip
& $VPy -m pip install -q -r requirements-portable.txt
if ($LASTEXITCODE) { Fail "pip install -r requirements-portable.txt failed (see the error above)." }
Ok "the libraries"

Step "5/7 The models (text reading, faces, speech, person cut-out)"
$env:SM_WHISPER = if ($env:WHISPER_MODEL) { $env:WHISPER_MODEL } else { "base.en" }
& $VPy analyzer\portable.py warmup
if ($LASTEXITCODE) { Fail "A model did not download (see the error above). Check the internet connection and run setup.cmd again." }
Ok "models"

Step "6/7 The web app"
Push-Location app
npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE) { Pop-Location; Fail "npm ci failed." }
Pop-Location
New-Item -ItemType Directory -Force -Path data, uploads, app\public | Out-Null
if (-not (Test-Path app\public\data)) { New-Item -ItemType Junction -Path app\public\data -Target (Join-Path $Root "data") | Out-Null }
Ok "app\node_modules, data\ (linked into the site)"

Step "7/7 Settings (.env)"
@("SM_PY=""$VPy""", "SM_WHISPER=""$($env:SM_WHISPER)""") | Set-Content -Encoding ascii .env
Ok ".env"

Write-Host "`nSetup is done. Start the site with start.cmd (or: powershell -ExecutionPolicy Bypass -File start.ps1)`n" -ForegroundColor Green
