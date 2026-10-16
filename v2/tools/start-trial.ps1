param([string]$ConfigFile='.\trial-config.json')
$ErrorActionPreference='Stop'
$trialConfigPath=(Resolve-Path -LiteralPath $ConfigFile).Path
$cfg=Get-Content -LiteralPath $trialConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($cfg.host -ne '127.0.0.1' -or $cfg.port -in @(3789,3790,3791,4389)) {throw 'Not an isolated trial config'}
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logRoot=Split-Path -Parent $trialConfigPath
$trialProcess=Start-Process -FilePath 'node' -ArgumentList @('v2/tools/start-trial.cjs',('"'+$trialConfigPath+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'trial-stdout.log') -RedirectStandardError (Join-Path $logRoot 'trial-stderr.log') -PassThru
for ($attempt=0;$attempt -lt 12;$attempt++) {
 try {$health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$cfg.port+'/api/health') -TimeoutSec 2; if ($health.trial.pid -eq $trialProcess.Id -and $health.knowledgeVersion -eq $cfg.expectedKnowledgeVersion) {Write-Output ('Trial ready: http://127.0.0.1:'+$cfg.port+'/quick and /huiai'); exit 0}} catch {}
 Start-Sleep -Milliseconds 300
}
throw ('Trial did not become ready; inspect '+(Join-Path $logRoot 'trial-stderr.log'))
