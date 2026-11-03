param([Parameter(Mandatory=$true)][string]$ConfigFile,[switch]$PolicyOnly)
$ErrorActionPreference='Stop'
function Get-DependencyAction([bool]$Ready,[bool]$Starting,[bool]$Cooling,[bool]$Allowed){
 if($Ready){return 'healthy'}
 if(!$Allowed){return 'not-authorized-now'}
 if($Starting){return 'starting'}
 if($Cooling){return 'cooling'}
 return 'start-existing'
}
if($PolicyOnly){return}
$cfg=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
$mutex=New-Object Threading.Mutex($false,'Global\XiaohuijiV2Dependencies8520');$held=$false
try{
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
 if(!$held){exit 0}
 $state=@{checkedAt=[DateTime]::UtcNow.ToString('o');embedding='native-section-index';model='unknown';lastModelStart='';errors=@()}
 if(Test-Path -LiteralPath $cfg.StateFile){$old=Get-Content -LiteralPath $cfg.StateFile -Raw -Encoding UTF8|ConvertFrom-Json;foreach($name in @('lastModelStart')){if($old.$name){$state[$name]=$old.$name}}}
 function Probe-Http([string]$url){try{$r=Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3;return $r.StatusCode -eq 200}catch{return $false}}
 function Cooling($stamp){return $stamp -and ([DateTime]::UtcNow-[DateTime]::Parse($stamp).ToUniversalTime()).TotalSeconds -lt 300}
 # Retrieval and embedding run in the native section-index process.
 $local=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'China Standard Time');$minute=$local.Hour*60+$local.Minute
 $temperatureLatched=$false;if(Test-Path -LiteralPath $cfg.ProtectionState){try{$temperatureLatched=(Get-Content -LiteralPath $cfg.ProtectionState -Raw|ConvertFrom-Json).fault.reason -eq 'gpu-hot'}catch{}}
 $allowed=$minute -ge 510 -and $minute -lt 1080 -and !$temperatureLatched
 $ready=Probe-Http 'http://127.0.0.1:8080/v1/models'
 $state.model=Get-DependencyAction $ready $false (Cooling $state.lastModelStart) $allowed
 if($state.model -eq 'start-existing'){
  # Reuse the existing schedule guard (temperature limit and latch).
  $state.lastModelStart=[DateTime]::UtcNow.ToString('o')
  & $cfg.ScheduleScript -Action start -Python $cfg.Python -Controller $cfg.ModelController -ProtectionState $cfg.ProtectionState|Out-Null
 }
 $temporary=$cfg.StateFile+'.tmp';$state|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $temporary -Encoding UTF8;Move-Item -LiteralPath $temporary -Destination $cfg.StateFile -Force
 $state|ConvertTo-Json -Depth 6
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
