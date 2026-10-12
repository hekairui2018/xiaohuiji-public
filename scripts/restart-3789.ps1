# One-click restart of the Xiaohuiji 3789 service so it reloads the latest code from disk.
# Safe to run repeatedly; kills whatever currently listens on 3789 and relaunches server.js hidden.
$ErrorActionPreference = "SilentlyContinue"
$Port        = 3789
$ProjectRoot = "D:\xiaohuiji"
$NodeExe     = "C:\Program Files\nodejs\node.exe"
$ServerJs    = Join-Path $ProjectRoot "backend\server.js"
$OutLog      = Join-Path $ProjectRoot "tmp\server-3789-out.log"
$ErrLog      = Join-Path $ProjectRoot "tmp\server-3789-err.log"

function Test-Listening([int]$p) {
    try {
        $eps = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        foreach ($e in $eps) { if ($e.Port -eq $p) { return $true } }
    } catch {}
    return $false
}

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600 }

if (Test-Path $NodeExe) {
    $env:PORT = "$Port"
    Start-Process -FilePath $NodeExe `
        -ArgumentList "`"$ServerJs`"" `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -WindowStyle Hidden | Out-Null
}

$ok = $false
for ($i = 0; $i -lt 12; $i++) { Start-Sleep -Seconds 1; if (Test-Listening $Port) { $ok = $true; break } }

# consume any pending one-shot restart flag so the watchdog path also settles
$flag = Join-Path $ProjectRoot "tmp\restart-3789.flag"
if (Test-Path $flag) { Remove-Item $flag -Force -ErrorAction SilentlyContinue }

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path (Join-Path $ProjectRoot "tmp\watchdog.log") -Value "$stamp Manual restart-3789.ps1 ran; recovered=$ok" -Encoding UTF8

$w = New-Object -ComObject Wscript.Shell
if ($ok) { [void]$w.Popup("HD log service restarted (port 3789), latest code loaded.", 5, "Xiaohuiji", 64) }
else     { [void]$w.Popup("HD log service restart FAILED. See tmp\server-3789-err.log", 10, "Xiaohuiji", 16) }
