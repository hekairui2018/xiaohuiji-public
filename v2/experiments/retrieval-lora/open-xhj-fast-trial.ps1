param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$runtimeDirectory=Join-Path $projectRoot 'tmp/qwen-fast-xhj-trial-20261020'
try { $resource=Invoke-WebRequest 'http://127.0.0.1:8521/health' -UseBasicParsing -TimeoutSec 3 } catch { throw 'The existing Xiaohuiji resource service on 8521 must be running first. No service was stopped.' }
& (Join-Path $PSScriptRoot 'open-studio-fast-chat.ps1') -NoBrowser
$health=$null
try { $health=Invoke-RestMethod 'http://127.0.0.1:8631/api/health' -TimeoutSec 3 } catch {}
if ($health -and $health.trial.model -ne 'Qwen3.5-0.8B-BF16') { throw 'Port 8631 belongs to another service. Nothing was stopped.' }
if (-not $health) {
    $listener=Get-NetTCPConnection -LocalPort 8631 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 8631 is occupied. Nothing was stopped.' }
    New-Item -ItemType Directory -Force $runtimeDirectory | Out-Null
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source -ArgumentList @(('"'+(Join-Path $projectRoot 'v2/tools/start-qwen-fast-trial.cjs')+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "start-$stamp.stdout.log") -RedirectStandardError (Join-Path $runtimeDirectory "start-$stamp.stderr.log") | Out-Null
    for ($attempt=0;$attempt -lt 60;$attempt++) {
        Start-Sleep -Seconds 1
        try { $health=Invoke-RestMethod 'http://127.0.0.1:8631/api/health' -TimeoutSec 2; if ($health.trial.model -eq 'Qwen3.5-0.8B-BF16') { break } } catch {}
    }
}
if ($health.trial.model -ne 'Qwen3.5-0.8B-BF16') { throw "Trial entry did not become ready. See $runtimeDirectory." }
Write-Output 'Xiaohuiji 0.8B retrieval trial: http://127.0.0.1:8631/huiai'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8631/huiai' }
