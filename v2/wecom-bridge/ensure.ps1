param([Parameter(Mandatory=$true)][string]$ConfigFile,[Parameter(Mandatory=$true)][string]$NodeExecutable)
$ErrorActionPreference='Stop'
$configAbsolute=[IO.Path]::GetFullPath($ConfigFile)
$cfg=Get-Content -LiteralPath $configAbsolute -Raw -Encoding UTF8|ConvertFrom-Json
$entry=Join-Path $PSScriptRoot 'main.cjs'
$mutex=[Threading.Mutex]::new($false,'Local\XiaohuijiV2Wecom8522')
if(!$mutex.WaitOne(0)){exit 0}
try{
 if(Test-Path -LiteralPath (Join-Path (Split-Path $configAbsolute) 'paused')){exit 0}
 $port=if($cfg.port){[int]$cfg.port}else{8522}
 try{$health=Invoke-RestMethod ('http://127.0.0.1:'+$port+'/health') -TimeoutSec 3;if($health.service -eq 'xiaohuiji-v2-wecom'){exit 0}}catch{}
 $existing=Get-CimInstance Win32_Process -Filter "Name='node.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Replace('\','/').Contains($entry.Replace('\','/')) -and $_.CommandLine.Replace('\','/').Contains($configAbsolute.Replace('\','/'))}
 if($existing){exit 0}
 if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw 'Bridge port owned by another process'}
 $dir=Split-Path $configAbsolute
 $stamp=Get-Date -Format yyyyMMdd-HHmmss
 Start-Process -FilePath $NodeExecutable -ArgumentList @(('"'+$entry+'"'),('"'+$configAbsolute+'"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dir ($stamp+'.stdout.log')) -RedirectStandardError (Join-Path $dir ($stamp+'.stderr.log'))|Out-Null
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
