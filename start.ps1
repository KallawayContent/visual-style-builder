# Start Visual Style Builder on Windows: http://127.0.0.1:5190 ($env:PORT for another port). Stop it with Ctrl+C.
Set-Location $PSScriptRoot
if (-not ((Test-Path app\node_modules) -and (Test-Path .env))) { Write-Host "Run setup.cmd first."; exit 1 }
$port = if ($env:PORT) { $env:PORT } else { "5190" }
Set-Location app
npx vite --port $port --strictPort --host 127.0.0.1 --open
