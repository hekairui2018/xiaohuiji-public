# HD Resident Guard - one hidden daemon keeps these alive (check every 30s):
#   1) Xiaohuiji quick-site on port 3789 (node)
#   2) Quick Access Popup (middle-click menu)
#   3) Xiaowang memo widget (WeeklyMemoWidget.ps1)
# Started hidden at logon via HKCU Run key "Xiaohuiji3789Guard"; single-instance mutex.
$ErrorActionPreference = "SilentlyContinue"

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'HDResidentGuard', [ref]$createdNew)
if (-not $createdNew) { exit }

$ProjectRoot = "D:\xiaohuiji"
$NodeExe     = "C:\Program Files\nodejs\node.exe"
$ServerJs    = Join-Path $ProjectRoot "backend\server.js"
$LogFile     = Join-Path $ProjectRoot "tmp\watchdog.log"
$OutLog      = Join-Path $ProjectRoot "tmp\server-3789-out.log"
$ErrLog      = Join-Path $ProjectRoot "tmp\server-3789-err.log"
$QapExe      = "C:\Program Files\Quick Access Popup\QuickAccessPopup.exe"
$XiaowangPs1 = "C:\Users\HD\Documents\Rainmeter\Skins\HDWeeklyMemo\WeeklyMemoWidget.ps1"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$ts $msg" -Encoding UTF8
    try { if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 512KB)) {
        Get-Content $LogFile -Tail 400 | Set-Content $LogFile -Encoding UTF8 } } catch {}
}
function Test-Port([int]$p) {
    try {
        $eps = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        foreach ($ep in $eps) { if ($ep.Port -eq $p) { return $true } }
    } catch {}
    return $false
}
function Test-Proc($name) { return [bool](Get-Process -Name $name -ErrorAction SilentlyContinue) }
function Test-Xiaowang {
    $p = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'WeeklyMemoWidget\.ps1' }
    return [bool]$p
}

function Ensure-Site {
    if (Test-Port 3789) { return }
    $conn = Get-NetTCPConnection -LocalPort 3789 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }
    if (-not (Test-Path $NodeExe)) { Write-Log "node.exe NOT FOUND"; return }
    $env:PORT = "3789"
    Start-Process -FilePath $NodeExe -ArgumentList "`"$ServerJs`"" -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -WindowStyle Hidden | Out-Null
    for ($i=0; $i -lt 10; $i++){ Start-Sleep -Seconds 1; if (Test-Port 3789){ Write-Log "Site 3789 recovered."; return } }
    Write-Log "Site 3789 FAILED to start."
}
function Ensure-Qap {
    if (Test-Proc "QuickAccessPopup") { return }
    if (Test-Path $QapExe) { Start-Process -FilePath $QapExe; Write-Log "QAP was down, relaunched." }
    else { Write-Log "QAP exe NOT FOUND" }
}
function Ensure-Xiaowang {
    if (Test-Xiaowang) { return }
    if (Test-Path $XiaowangPs1) {
        Start-Process -FilePath "powershell.exe" -ArgumentList @(
            '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',"`"$XiaowangPs1`"") -WindowStyle Hidden | Out-Null
        Write-Log "Xiaowang widget was down, relaunched."
    } else { Write-Log "Xiaowang ps1 NOT FOUND" }
}

function Invoke-GuardRound { Ensure-Site; Ensure-Qap; Ensure-Xiaowang }

Write-Log "Resident guard started (pid $PID): site3789 + QAP + Xiaowang."
Invoke-GuardRound   # fix immediately on start, don't wait one cycle
while ($true) {
    try { Invoke-GuardRound } catch { Write-Log "guard error: $($_.Exception.Message)" }
    Start-Sleep -Seconds 30
}
