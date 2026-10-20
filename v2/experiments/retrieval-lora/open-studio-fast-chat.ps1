param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$outputRoot = Join-Path $projectRoot 'tmp/studio-fast-chat-20261020'
$pythonPath = Join-Path $projectRoot 'tmp/qwen35-speed-lab/venv/Scripts/python.exe'
$scriptPath = Join-Path $PSScriptRoot 'studio_fast_server.py'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
try { $health = Invoke-RestMethod 'http://127.0.0.1:8890/health' -TimeoutSec 3 } catch { $health = $null }
if ($health -and $health.service -ne 'xhj-studio-fast-chat') { throw 'Port 8890 belongs to another service. Nothing was stopped.' }
if (-not $health) {
    # Never replace an unidentified listener or terminate any existing service.
    $listener = Get-NetTCPConnection -LocalPort 8890 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 8890 is occupied by another process; nothing was stopped.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath $pythonPath -ArgumentList @('-X','utf8','-u',('"' + $scriptPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outputRoot "startup-$stamp.stdout.log") -RedirectStandardError (Join-Path $outputRoot "startup-$stamp.stderr.log") | Out-Null
}
Write-Host 'Preparing the local BF16 CUDA Graph model. First startup may take a minute.'
for ($attempt = 0; $attempt -lt 300; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8890/health' -TimeoutSec 2
        if ($health.ready) { break }
    } catch {}
    Start-Sleep -Seconds 2
}
if (-not $health.ready) { throw "Local model initialization failed. Check $outputRoot. No existing service was stopped." }
& (Join-Path $PSScriptRoot 'open-studio.ps1') -NoBrowser:$NoBrowser
