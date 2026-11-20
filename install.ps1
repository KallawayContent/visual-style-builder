# Visual Style Builder: the one-line install for Windows 10 / 11. Paste this into PowerShell (Start menu > PowerShell):
#   irm https://raw.githubusercontent.com/KallawayContent/visual-style-builder/main/install.ps1 | iex
# It needs no git. It downloads the code into %USERPROFILE%\visual-style-builder ($env:VSB_DIR for another folder), runs
# setup.ps1 (it installs Python, Node.js and FFmpeg with winget when they are missing), then starts the site ($env:NO_START=1 to skip).
# Running it again updates the code and keeps your analyzed videos (data\) and the installed libraries.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = if ($env:VSB_DIR) { $env:VSB_DIR } else { Join-Path $HOME "visual-style-builder" }
Write-Host "Visual Style Builder: installing into $Dir" -ForegroundColor Cyan
$Tmp = Join-Path $env:TEMP ("vsb-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
  Invoke-WebRequest -UseBasicParsing "https://github.com/KallawayContent/visual-style-builder/archive/refs/heads/main.zip" -OutFile (Join-Path $Tmp "vsb.zip")
  Expand-Archive (Join-Path $Tmp "vsb.zip") -DestinationPath $Tmp -Force
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Copy-Item -Path (Join-Path $Tmp "visual-style-builder-main\*") -Destination $Dir -Recurse -Force
} catch {
  Write-Host "The download did not work: $($_.Exception.Message). Check the internet connection and paste the line again." -ForegroundColor Red
  return
} finally { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir "setup.ps1")
if ($LASTEXITCODE) { Write-Host "The setup stopped (see the message above). Fix it, then paste the line again." -ForegroundColor Red; return }
if (-not $env:NO_START) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir "start.ps1") }
