param([string]$ConfigFile, [switch]$PolicyOnly, [switch]$Loop)
$ErrorActionPreference='Stop'
function Get-GuardDecision([bool]$Healthy,[bool]$Foreign,[bool]$Running,[int]$Failures,[bool]$Paused,[bool]$Cooling){
 if($Paused){return 'paused'}
 if($Healthy){return 'healthy'}
 if($Foreign){return 'blocked-foreign-owner'}
 if($Cooling){return 'starting-or-cooling'}
 if($Running -and $Failures -lt 3){return 'wait-for-three-failures'}
 if($Running){return 'restart-owned'}
 return 'start'
}
if($PolicyOnly){return}
if(!$ConfigFile){throw 'Explicit private service config required'}
$cfg=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($port in @($cfg.Port,$cfg.ResourcePort)){if($port -lt 1024 -or $port -gt 65535 -or $port -in @(3789,3790,3791,8080)){throw 'Invalid isolated V2 port'}}
if($cfg.Port -eq $cfg.ResourcePort){throw 'Ports must differ'}
foreach($file in @($cfg.Node,$cfg.Entry,$cfg.IndexExecutable,$cfg.IndexEntry)){if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'Required service executable/entry missing'}}
$stateDir=[IO.Path]::GetFullPath($cfg.StateDirectory)
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$stateFile=Join-Path $stateDir 'watchdog-state.json'
$logFile=Join-Path $stateDir 'watchdog.log'
$pauseFile=Join-Path $stateDir 'watchdog.pause'
$mutex=New-Object Threading.Mutex($false,('Global\XiaohuijiV2Watchdog-'+$cfg.Port))
$held=$false
function Write-GuardLog($message){
 Add-Content -LiteralPath $logFile -Value ((Get-Date -Format s)+' '+$message) -Encoding UTF8
 if((Get-Item -LiteralPath $logFile).Length -gt 1MB){$tail=Get-Content -LiteralPath $logFile -Tail 400;Set-Content -LiteralPath $logFile -Value $tail -Encoding UTF8}
}
function Port-Owner([int]$port){
 $owners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique)
 if($owners.Count -gt 1){return -1};if($owners.Count -eq 1){return [int]$owners[0]};return 0
}
function Process-Proof([int]$processId,[string]$executable,[string]$entry){
 if($processId -le 0){return $null}
 $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -ErrorAction SilentlyContinue
 if(!$p -or !$p.ExecutablePath -or !$p.CommandLine){return $null}
 if(![string]::Equals([IO.Path]::GetFullPath($p.ExecutablePath),[IO.Path]::GetFullPath($executable),[StringComparison]::OrdinalIgnoreCase)){return $null}
 $full=[IO.Path]::GetFullPath($entry);$relative=$full.Substring([IO.Path]::GetFullPath($cfg.ProjectRoot).TrimEnd('\').Length+1).Replace('\','/')
 if($p.CommandLine.IndexOf($full,[StringComparison]::OrdinalIgnoreCase) -lt 0 -and $p.CommandLine.Replace('\','/').IndexOf($relative,[StringComparison]::OrdinalIgnoreCase) -lt 0){return $null}
 return @{pid=$processId;created=$p.CreationDate.ToUniversalTime().ToString('o');parent=[int]$p.ParentProcessId}
}
function Same-Proof($a,$b){return $a -and $b -and $a.pid -eq $b.pid -and $a.created -eq $b.created}
function Probe([int]$port){try{return Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/health') -TimeoutSec 3}catch{return $null}}
function Save-State($state){$state.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$temporary=$stateFile+'.tmp';$state|ConvertTo-Json -Depth 7|Set-Content -LiteralPath $temporary -Encoding UTF8;Move-Item -LiteralPath $temporary -Destination $stateFile -Force}
function Read-State{
 $value=@{failures=0;lastStart='';main=$null;index=$null;action='initial';updatedAt=''}
 if(Test-Path -LiteralPath $stateFile){$old=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8|ConvertFrom-Json;foreach($p in $old.PSObject.Properties){$value[$p.Name]=$p.Value}}
 return $value
}
function Stop-Proven($proof,[string]$executable,[string]$entry){
 if(!$proof){return}
 $now=Process-Proof $proof.pid $executable $entry
 if($now -and !(Same-Proof $proof $now)){throw 'PID identity changed; no process stopped'}
 if($now){Stop-Process -Id $proof.pid -ErrorAction Stop;for($i=0;$i -lt 20;$i++){if(!(Get-Process -Id $proof.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}}
}
function Guard-Once{
 $state=Read-State
 if(Test-Path -LiteralPath $pauseFile){$state.action='paused';Save-State $state;return}
 $mainOwner=Port-Owner $cfg.Port;$indexOwner=Port-Owner $cfg.ResourcePort
 $h=Probe $cfg.Port;$r=Probe $cfg.ResourcePort
 $healthy=$h -and $h.trial.instance -eq 'v2-offline' -and $h.trial.port -eq $cfg.Port -and $h.trial.resourcePort -eq $cfg.ResourcePort -and $h.trial.pid -eq $mainOwner -and $r.pid -eq $indexOwner -and $h.trial.indexPid -eq $indexOwner
 if($healthy){
  $main=Process-Proof $mainOwner $cfg.Node $cfg.Entry;$index=Process-Proof $indexOwner $cfg.IndexExecutable $cfg.IndexEntry
  if(!$main -or !$index -or $index.parent -ne $main.pid){throw 'Healthy endpoint process identity not confirmed'}
  $state.main=$main;$state.index=$index;$state.failures=0;$state.action='healthy';Save-State $state;return
 }
 $main=if($state.main){Process-Proof $state.main.pid $cfg.Node $cfg.Entry}else{$null}
 $index=if($state.index){Process-Proof $state.index.pid $cfg.IndexExecutable $cfg.IndexEntry}else{$null}
 $ownedMain=Same-Proof $state.main $main;$ownedIndex=Same-Proof $state.index $index
 $foreign=($mainOwner -ne 0 -and (!$ownedMain -or $mainOwner -ne $main.pid)) -or ($indexOwner -ne 0 -and (!$ownedIndex -or $indexOwner -ne $index.pid))
 $state.failures=[int]$state.failures+1
 $cooling=$false;if($state.lastStart){$cooling=((Get-Date).ToUniversalTime()-[datetime]::Parse($state.lastStart).ToUniversalTime()).TotalSeconds -lt 120}
 $state.action=Get-GuardDecision $false $foreign ([bool]($ownedMain -or $ownedIndex)) $state.failures $false $cooling
 if($state.action -in @('blocked-foreign-owner','starting-or-cooling','wait-for-three-failures')){Save-State $state;Write-GuardLog ($state.action+' failures='+$state.failures);return}
 if($ownedMain){Stop-Proven $state.main $cfg.Node $cfg.Entry}
 if($ownedIndex){Stop-Proven $state.index $cfg.IndexExecutable $cfg.IndexEntry}
 if((Port-Owner $cfg.Port) -ne 0 -or (Port-Owner $cfg.ResourcePort) -ne 0){throw 'Port still occupied; no duplicate launch'}
 $arguments=@($cfg.Entry)+@($cfg.Arguments)
 foreach($argument in $arguments){if($argument.Contains('"') -or $argument.Contains("`n")){throw 'Invalid launch argument'}}
 $quoted=($arguments|ForEach-Object {'"'+$_+'"'}) -join ' '
 $state.lastStart=(Get-Date).ToUniversalTime().ToString('o');Save-State $state
 $p=Start-Process -FilePath $cfg.Node -ArgumentList $quoted -WorkingDirectory $cfg.ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'receiver.stdout.log') -RedirectStandardError (Join-Path $stateDir 'receiver.stderr.log') -PassThru
 $state.main=Process-Proof $p.Id $cfg.Node $cfg.Entry;$state.index=$null;Save-State $state
 Write-GuardLog ('launched verified entry PID='+$p.Id)
 for($i=0;$i -lt 25;$i++){
  $ready=Probe $cfg.Port
  if($ready.trial.instance -eq 'v2-offline' -and $ready.trial.pid -eq $p.Id){
   $index=Process-Proof $ready.trial.indexPid $cfg.IndexExecutable $cfg.IndexEntry
   if($index -and $index.parent -eq $p.Id){$state.index=$index;$state.action='started';Save-State $state;Write-GuardLog ('receiver ready PID='+$p.Id);return}
  }
  if($p.HasExited){throw 'Receiver exited during start; inspect private stderr log'}
  Start-Sleep -Seconds 1
 }
 Write-GuardLog 'startup pending; 120-second cooldown prevents repeated launches'
}
try{
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
 if(!$held){exit 0}
 do{
  try{Guard-Once}catch{Write-GuardLog ('guard-error '+$_.Exception.Message);if(!$Loop){throw}}
  if($Loop){Start-Sleep -Seconds 60}
 }while($Loop)
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
