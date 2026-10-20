param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$studioRoot = Join-Path $projectRoot 'tmp/unsloth-studio-20261020'
$studioHome = Join-Path $studioRoot 'home/studio'
$studioPython = Join-Path $studioHome 'unsloth_studio/Scripts/python.exe'
$studioUrl = 'http://127.0.0.1:8888'
if (!(Test-Path $studioPython)) { throw 'Studio is not installed yet.' }

function Get-StudioPage {
    try { return Invoke-WebRequest -Uri "$studioUrl/" -TimeoutSec 3 -UseBasicParsing }
    catch { return $null }
}
function Get-StudioHealth {
    try {
        $health = Invoke-RestMethod -Uri "$studioUrl/api/health" -TimeoutSec 4
        return ($health.status -eq 'healthy' -and $health.service -eq 'Unsloth UI Backend')
    } catch { return $false }
}
$page = Get-StudioPage
if ($page -and $page.Content -notmatch '(?i)unsloth') {
    throw 'Port 8888 is occupied by a different application. Nothing was stopped.'
}
$healthy = Get-StudioHealth
if (!$healthy -and $page) {
    throw 'Port 8888 serves a page but the Studio backend is unhealthy. See the Studio logs; no existing process was stopped.'
}
if (!$healthy) {
    # Process-local settings; the experiment environment and system settings stay intact.
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:UNSLOTH_HOME = Join-Path $studioRoot 'home'
    $env:UNSLOTH_STUDIO_HOME = $studioHome
    $env:HF_HOME = Join-Path $studioRoot 'hf-cache'
    $env:TOKENIZERS_PARALLELISM = 'false'
    $env:WANDB_DISABLED = 'true'
    # Keep the pinned image package; this text-model experiment does not need a Git main build.
    $env:UNSLOTH_DIFFUSERS_MAIN = '0'
    # Native Windows GPU compilers require an ASCII cache path.
    $compileRoot = Join-Path ([IO.Path]::GetTempPath()) 'xhj-unsloth-studio-20261020'
    $env:TRITON_CACHE_DIR = Join-Path $compileRoot 'triton'
    $env:TORCHINDUCTOR_CACHE_DIR = Join-Path $compileRoot 'inductor'
    $env:UNSLOTH_COMPILE_LOCATION = Join-Path $compileRoot 'unsloth'
    # Preserve previous crash evidence instead of overwriting the last launch logs.
    $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    foreach ($logName in @('server.stdout.log', 'server.stderr.log')) {
        $logFile = Join-Path $studioRoot $logName
        if (Test-Path -LiteralPath $logFile) {
            Copy-Item -LiteralPath $logFile -Destination (Join-Path $studioRoot "$logStamp-$logName")
        }
    }
    $process = Start-Process -FilePath $studioPython -ArgumentList @(
        '-X', 'utf8', '-I', '-m', 'unsloth_cli', 'studio',
        '--host', '127.0.0.1', '--port', '8888', '--no-cloudflare'
    ) -WorkingDirectory $studioRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $studioRoot 'server.stdout.log') `
        -RedirectStandardError (Join-Path $studioRoot 'server.stderr.log')
    $process.Id | Set-Content (Join-Path $studioRoot 'launcher.pid')
    $deadline = (Get-Date).AddMinutes(4)
    do {
        Start-Sleep -Seconds 2
        $page = Get-StudioPage
        $healthy = Get-StudioHealth
        if ($healthy -and $page) { break }
        $process.Refresh()
        if ($process.HasExited) {
            throw "Studio exited. See $studioRoot/server.stderr.log"
        }
    } while ((Get-Date) -lt $deadline)
    if (!$healthy -or !$page -or $page.Content -notmatch '(?i)unsloth') {
        throw "Studio did not become ready. See $studioRoot/server.stderr.log"
    }
}
Write-Output "Unsloth Studio: $studioUrl"
if (!$NoBrowser) { Start-Process $studioUrl }
