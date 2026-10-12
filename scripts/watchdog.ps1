# Xiaohuiji 3789 watchdog (robust, no console window)
# Scheduled task runs this hidden every 1 minute and at user logon.
# Pure-.NET port probe (never spawns netstat, so no black window / no Exec failure).
$ErrorActionPreference = "SilentlyContinue"

$Port        = 3789
$ProjectRoot = "D:\xiaohuiji"
$NodeExe     = "C:\Program Files\nodejs\node.exe"
$ServerJs    = Join-Path $ProjectRoot "backend\server.js"
$LogFile     = Join-Path $ProjectRoot "tmp\watchdog.log"
$OutLog      = Join-Path $ProjectRoot "tmp\server-3789-out.log"
$ErrLog      = Join-Path $ProjectRoot "tmp\server-3789-err.log"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$ts $msg" -Encoding UTF8
    # keep the log from growing forever: trim to last 400 lines if > 512KB
    try {
        if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) {
            Get-Content $LogFile -Tail 400 | Set-Content $LogFile -Encoding UTF8
        }
    } catch {}
}

function Test-Listening([int]$p) {
    try {
        $eps = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        foreach ($ep in $eps) { if ($ep.Port -eq $p) { return $true } }
    } catch {}
    return $false
}

function Start-Server {
    # clear anything half-bound to the port first
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }
    if (-not (Test-Path $NodeExe)) { Write-Log "node.exe NOT FOUND at $NodeExe"; return $false }
    $env:PORT = "$Port"
    Start-Process -FilePath $NodeExe `
        -ArgumentList "`"$ServerJs`"" `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -WindowStyle Hidden | Out-Null
    # wait up to 10s for the port to come up
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Listening $Port) { return $true }
    }
    return $false
}

# --- one-shot restart trigger: presence of tmp\restart-3789.flag forces one reload, then flag is removed.
#     No flag file = absolutely no behavior change (normal healthy -> silent exit path). Safe to leave in place.
# Dispatch the other release restarts through this confirmed scheduled entry, too.
# Existing bridge/admin schedules remain unchanged; their one-shot flags are consumed by their own scripts.
foreach ($service in @(
    @{ Port=3790; Script='wecom-bridge\scripts\ensure-bridge.ps1' },
    @{ Port=3791; Script='scripts\watchdog-3791.ps1' }
)) {
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot "tmp\restart-$($service.Port).flag")) {
        $serviceScript = Join-Path $ProjectRoot $service.Script
        Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',"`"$serviceScript`"") `
            -WindowStyle Hidden | Out-Null
    }
}
$RestartFlag = Join-Path $ProjectRoot "tmp\restart-3789.flag"
if (Test-Path $RestartFlag) {
    $oldConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $previousPid = if ($oldConn) { $oldConn.OwningProcess } else { 0 }
    Write-Log "Restart flag found, force-restarting server to reload latest code..."
    try { Remove-Item $RestartFlag -Force -ErrorAction SilentlyContinue } catch {}
    $rok = Start-Server
    if ($rok -and (Test-Path (Join-Path $ProjectRoot 'release-info.json'))) {
        & (Join-Path $ProjectRoot 'scripts\write-release-health.ps1') -Port $Port -PreviousPid $previousPid
    }
    if ($rok) { Write-Log "Restart via flag: port $Port recovered." }
    else     { Write-Log "Restart via flag: FAILED to start; see server-3789-err.log" }
    exit 0
}

if (Test-Listening $Port) { exit 0 }   # healthy -> stay silent

Write-Log "Port $Port down, starting server..."
$ok = Start-Server
if ($ok) {
    Write-Log "Port $Port recovered."
    exit 0
}
# one retry before giving up (next scheduled run will try again anyway)
Start-Sleep -Seconds 2
$ok = Start-Server
if ($ok) { Write-Log "Port $Port recovered on retry." }
else     { Write-Log "Port $Port FAILED to start; see server-3789-err.log" }
exit 0
