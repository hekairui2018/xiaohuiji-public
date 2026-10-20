$ErrorActionPreference='Stop'
. "$PSScriptRoot\watchdog-offline.ps1" -PolicyOnly
$cases=@(
 @($true,$false,$true,0,$false,$false,'healthy'),
 @($false,$false,$false,1,$false,$false,'start'),
 @($false,$false,$true,1,$false,$false,'wait-for-three-failures'),
 @($false,$false,$true,2,$false,$false,'wait-for-three-failures'),
 @($false,$false,$true,3,$false,$false,'restart-owned'),
 @($false,$true,$false,4,$false,$false,'blocked-foreign-owner'),
 @($false,$true,$true,4,$false,$false,'blocked-foreign-owner'),
 @($false,$false,$false,9,$true,$false,'paused'),
 @($false,$false,$true,9,$false,$true,'starting-or-cooling'),
 @($false,$false,$false,9,$false,$true,'starting-or-cooling')
)
foreach($case in $cases){$actual=Get-GuardDecision $case[0] $case[1] $case[2] $case[3] $case[4] $case[5];if($actual -ne $case[6]){throw ('Policy mismatch: '+$actual+' expected '+$case[6])}}
Write-Output 'OFFLINE_WATCHDOG_POLICY pass=10 fail=0; no device/server actions'
