param(
 [Parameter(Mandatory=$true)][ValidateSet('start','stop')][string]$Action,
 [Parameter(Mandatory=$true)][string]$Python,
 [Parameter(Mandatory=$true)][string]$Controller,
 [Parameter(Mandatory=$true)][string]$ProtectionState,
 [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$localTime=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'China Standard Time')
$minutes=$localTime.Hour*60+$localTime.Minute
$open=$minutes -ge 510 -and $minutes -lt 1080
# A delayed/missed trigger must not start a model at night or stop it next morning.
if(($Action -eq 'start' -and !$open) -or ($Action -eq 'stop' -and $open)){Write-Output 'Outside trigger window; no model operation';exit 0}
if($Action -eq 'start' -and (Test-Path -LiteralPath $ProtectionState)){throw 'Expert protection is latched; inspect the fault before starting the model'}
foreach($required in @($Python,$Controller)){if(!(Test-Path -LiteralPath $required -PathType Leaf)){throw 'Model controller executable or script missing'}}
if($ValidateOnly){Write-Output ('Validated '+$Action+'; model unchanged');exit 0}
if($Action -eq 'start'){
 $gpuRows=& nvidia-smi --query-gpu=temperature.gpu,memory.free --format=csv,noheader,nounits
 if($LASTEXITCODE -ne 0 -or !$gpuRows){throw 'GPU state is unavailable'}
 foreach($row in $gpuRows){$values=$row.Split(',');if($values.Count -ne 2 -or [double]$values[0] -ge 85 -or [double]$values[1] -lt 384){throw 'GPU protection threshold reached'}}
 if((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory -lt 1048576){throw 'Host memory protection threshold reached'}
}
& $Python -X utf8 $Controller $(if($Action -eq 'start'){'on'}else{'off'})
if($LASTEXITCODE -ne 0){throw 'Model controller did not complete the requested operation'}
