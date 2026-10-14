param([string]$RuntimeFile='E:\开发产物\小灰机\v2-stage17\runtime\runtime.json')
$ErrorActionPreference='Stop'
$runtime=Get-Content -LiteralPath $RuntimeFile -Raw | ConvertFrom-Json
if ($runtime.instance -ne 'v2-stage17-3060' -or $runtime.host -ne '127.0.0.1' -or $runtime.port -in @(3789,3790,3791,4389)) {throw 'Not an isolated trial runtime'}
$trialPid=[int]$runtime.pid
$trialProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$trialPid)
if (!$trialProcess) {Write-Output 'Trial is already stopped'; exit 0}
if ($trialProcess.CommandLine -notlike '*v2/tools/start-trial.cjs*' -or !$trialProcess.CommandLine.Contains([string]$runtime.configFile)) {throw 'Process identity mismatch; no process was stopped'}
Stop-Process -Id $trialPid
Write-Output 'Stopped the verified local trial only'
