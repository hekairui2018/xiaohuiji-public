# Xiaohuiji 3791 QA admin watchdog (robust, no console window)
# Scheduled task runs this hidden every 1 minute and at user logon.
# Pure-.NET port probe (never spawns netstat, no black window / no Exec failure).
$ErrorActionPreference = "SilentlyContinue"

$Port        = 3791
$ProjectRoot = "D:\xiaohuiji"
$NodeExe     = "C:\Program Files\nodejs\node.exe"
$ServerJs    = Join-Path $ProjectRoot "admin\admin-server.cjs"
$LogFile     = Join-Path $ProjectRoot "tmp\watchdog-3791.log"
$OutLog      = Join-Path $ProjectRoot "tmp\admin-3791-out.log"
$ErrLog      = Join-Path $ProjectRoot "tmp\admin-3791-err.log"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$ts $msg" -Encoding UTF8
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
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }
    if (-not (Test-Path $NodeExe)) { Write-Log "node.exe NOT FOUND at $NodeExe"; return $false }
    $env:ADMIN_NO_OPEN = "1"
    Start-Process -FilePath $NodeExe `
        -ArgumentList "`"$ServerJs`"" `
        -WorkingDirectory (Join-Path $ProjectRoot "admin") `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Listening $Port) { return $true }
    }
    return $false
}

$restartFlag = Join-Path $ProjectRoot 'tmp\restart-3791.flag'
if (Test-Path -LiteralPath $restartFlag) {
    $oldConn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $previousPid = if ($oldConn) { $oldConn.OwningProcess } else { 0 }
    Remove-Item -LiteralPath $restartFlag -Force
    Write-Log 'Release restart requested.'
    if (Start-Server) {
        if (Test-Path (Join-Path $ProjectRoot 'release-info.json')) {
            & (Join-Path $ProjectRoot 'scripts\write-release-health.ps1') -Port $Port -PreviousPid $previousPid
        }
        Write-Log 'Release restart finished.'
    } else { Write-Log 'Release restart FAILED.' }
    exit 0
}

if (Test-Listening $Port) { exit 0 }   # healthy -> stay silent

Write-Log "Port $Port down, starting admin server..."
$ok = Start-Server
if ($ok) {
    Write-Log "Port $Port recovered."
    exit 0
}
Start-Sleep -Seconds 2
$ok = Start-Server
if ($ok) { Write-Log "Port $Port recovered on retry." }
else     { Write-Log "Port $Port FAILED to start; see admin-3791-err.log" }
exit 0
