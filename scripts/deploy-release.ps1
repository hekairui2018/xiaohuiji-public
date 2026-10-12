param(
    [Parameter(Mandatory=$true)][string]$PackageDirectory,
    [string]$DeploymentRoot = '\\192.168.30.101\D\xiaohuiji',
    [switch]$Rollback,
    [switch]$FinalizeRollback
)
$ErrorActionPreference = 'Stop'
$packageAbsolute = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
$targetAbsolute = [IO.Path]::GetFullPath($DeploymentRoot).TrimEnd('\')
if ($targetAbsolute -ne '\\192.168.30.101\D\xiaohuiji') { throw 'Unexpected deployment root' }
$info = Get-Content -LiteralPath (Join-Path $packageAbsolute 'release-info.json') -Raw | ConvertFrom-Json
if ($info.version -notmatch '^test-\d{8}-\d{6}$') { throw 'Invalid version' }
$backupRoot = Join-Path $targetAbsolute "archive\releases\$($info.version)\rollback"
$stateFile = Join-Path $backupRoot 'deployment-state.json'
$runtimeFiles = @('data/admin-state.json','data/intent-cache.json','data/nlu-labels.jsonl')
function Get-SafeTarget([string]$relative, [string]$root) {
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Unsafe manifest path' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $full.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped root' }
    return $full
}
$restartScripts = @('scripts/watchdog.ps1','scripts/watchdog-3791.ps1','wecom-bridge/scripts/ensure-bridge.ps1','scripts/write-release-health.ps1')
if ($Rollback -or $FinalizeRollback) {
    $state = @(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json)
    foreach ($item in $state) {
        if ($Rollback -and $item.path -in $restartScripts) { continue }
        if ($FinalizeRollback -and $item.path -notin $restartScripts) { continue }
        $target = Get-SafeTarget $item.path $targetAbsolute
        if ($item.existed) {
            Copy-Item -LiteralPath (Get-SafeTarget $item.path $backupRoot) -Destination $target -Force
        } elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
    # Watchdog extensions remain available until all three old services have restarted.
    # The publisher restores these three scripts from backup after validating rollback health.
    Write-Output "Restored deployment files from $backupRoot"
    exit 0
}
if (Test-Path -LiteralPath $stateFile) { throw 'Backup already exists; do not overwrite a rollback baseline' }
$manifest = @(Get-Content -LiteralPath (Join-Path $packageAbsolute 'release-manifest.json') -Raw | ConvertFrom-Json)
$entries = @($manifest | Where-Object { $_.path -notin $runtimeFiles })
$entries += [pscustomobject]@{ path='release-manifest.json'; sha256=(Get-FileHash -LiteralPath (Join-Path $packageAbsolute 'release-manifest.json') -Algorithm SHA256).Hash }
foreach ($item in $entries) {
    $source = Get-SafeTarget $item.path $packageAbsolute
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $item.sha256) { throw "Package hash mismatch: $($item.path)" }
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$state = @()
# Back up every destination before writing the first runtime file. No recursive move/delete or junction traversal.
foreach ($item in $entries) {
    $target = Get-SafeTarget $item.path $targetAbsolute
    $exists = Test-Path -LiteralPath $target
    if ($exists) {
        $backup = Get-SafeTarget $item.path $backupRoot
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $backup
    }
    $state += [pscustomobject]@{ path=$item.path; existed=$exists }
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding utf8
foreach ($item in $entries) {
    $target = Get-SafeTarget $item.path $targetAbsolute
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Get-SafeTarget $item.path $packageAbsolute) -Destination $target -Force
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item.sha256) { throw "Deployed hash mismatch: $($item.path)" }
}
Write-Output "Deployed $($entries.Count) files; backup=$backupRoot"
exit 0
