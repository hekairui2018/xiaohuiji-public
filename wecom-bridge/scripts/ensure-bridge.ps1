# 小灰机企微瘦桥看门狗：进程不在就无窗拉起；进程在且健康端口可达则不动。
# 连接级断线由 SDK 自动重连，本脚本不因“瞬时未认证”而杀进程，避免抖动。
$ErrorActionPreference = "Continue"
$bridgeDirectory = "D:\xiaohuiji\wecom-bridge"
$nodeExecutable = "C:\Program Files\nodejs\node.exe"
$entryScript = Join-Path $bridgeDirectory "src\index.mjs"
$healthUrl = "http://127.0.0.1:3790/health"
$logDir = Join-Path $bridgeDirectory "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$mutex = New-Object System.Threading.Mutex($false, "Global\XiaohuijiWecomBridgeWatchdog")
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
  function Get-BridgeProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'wecom-bridge[\\/]src[\\/]index\.mjs' }
  }

  $proc = Get-BridgeProcess
  $projectRoot = Split-Path -Parent $bridgeDirectory
  $restartFlag = Join-Path $projectRoot 'tmp\restart-3790.flag'
  $previousPid = 0
  $restartRequested = Test-Path -LiteralPath $restartFlag
  if ($restartRequested) {
    $previousPid = if ($proc) { ($proc | Select-Object -First 1).ProcessId } else { 0 }
    if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } }
    Remove-Item -LiteralPath $restartFlag -Force
    Start-Sleep -Milliseconds 600
    $proc = Get-BridgeProcess
  }
  if ($proc) {
    try { Invoke-RestMethod $healthUrl -TimeoutSec 5 | Out-Null } catch { }
    exit 0
  }

  $busy = Get-NetTCPConnection -LocalPort 3790 -State Listen -ErrorAction SilentlyContinue
  if ($busy) { Write-Output "port 3790 held by another process, skip start"; exit 0 }
  if (-not (Test-Path $entryScript)) { Write-Output "entry missing: $entryScript"; exit 1 }

  $outLog = Join-Path $logDir "bridge-out.log"
  $errLog = Join-Path $logDir "bridge-err.log"
  Start-Process -FilePath $nodeExecutable -ArgumentList "`"$entryScript`"" `
    -WorkingDirectory $bridgeDirectory -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  Write-Output ("started xiaohuiji wecom-bridge at " + (Get-Date -Format o))
  if ($restartRequested -and (Test-Path (Join-Path $projectRoot 'release-info.json'))) {
    & (Join-Path $projectRoot 'scripts\write-release-health.ps1') -Port 3790 -PreviousPid $previousPid
  }
}
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
