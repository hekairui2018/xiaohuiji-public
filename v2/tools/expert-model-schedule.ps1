param(
 [Parameter(Mandatory=$true)][ValidateSet('start','stop')][string]$Action,
 [Parameter(Mandatory=$true)][string]$Python,
 [Parameter(Mandatory=$true)][string]$Controller,
 [Parameter(Mandatory=$true)][string]$ProtectionState,
 [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
# Operating-hour restriction is disabled; explicit start/stop actions remain available.
if($Action -eq 'start' -and (Test-Path -LiteralPath $ProtectionState)){try{$savedProtection=Get-Content -LiteralPath $ProtectionState -Raw|ConvertFrom-Json}catch{$savedProtection=$null};if($savedProtection.fault.reason -eq 'gpu-hot'){throw 'Temperature protection is latched; inspect before starting the model'}}
foreach($required in @($Python,$Controller)){if(!(Test-Path -LiteralPath $required -PathType Leaf)){throw 'Model controller executable or script missing'}}
if($ValidateOnly){Write-Output ('Validated '+$Action+'; model unchanged');exit 0}
if($Action -eq 'start'){
 try{$gpuRows=& nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null;$sampleOk=$LASTEXITCODE -eq 0}catch{$sampleOk=$false}
 if($sampleOk -and $gpuRows){foreach($row in $gpuRows){$sample=0.0;if([double]::TryParse($row.Trim(),[ref]$sample) -and $sample -ge 85){throw 'Temperature protection threshold reached'}}}
}
& $Python -X utf8 $Controller $(if($Action -eq 'start'){'on'}else{'off'})
if($LASTEXITCODE -ne 0){throw 'Model controller did not complete the requested operation'}
