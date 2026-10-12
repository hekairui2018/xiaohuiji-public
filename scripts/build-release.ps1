param(
    [Parameter(Mandatory=$true)][string]$Version,
    [string]$OutputRoot = 'E:\开发产物\小灰机'
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$commit = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot determine source commit' }
if (@(& git -C $sourceRoot status --porcelain).Count -ne 0) { throw 'Commit source changes before packaging' }
if ($Version -notmatch '^test-\d{8}-\d{6}$') { throw 'Invalid release version' }
$outputDir = Join-Path $OutputRoot $Version
if (Test-Path -LiteralPath $outputDir) { throw 'Release directory already exists; use a new build version' }
$stage = Join-Path $outputDir 'package'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$archive = Join-Path $outputDir 'source.zip'
& git -C $sourceRoot archive --format=zip -o $archive $commit
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive -LiteralPath $archive -DestinationPath $stage
$buildTime = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'China Standard Time').ToString('o')
$info = [ordered]@{ version=$Version; commit=$commit; build_time=$buildTime }
$info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'release-info.json') -Encoding utf8
$stageAbsolute = [IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
$manifest = @(Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
    [ordered]@{ path=$_.FullName.Substring($stageAbsolute.Length).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'release-manifest.json') -Encoding utf8
$zip = Join-Path $outputDir "xiaohuiji-$Version.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath (Join-Path $outputDir 'SHA256SUMS.txt') -Encoding ascii
$receipt = [ordered]@{ version=$Version; commit=$commit; build_time=$buildTime; package=$zip; sha256=$hash; file_count=$manifest.Count }
$receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputDir 'build-receipt.json') -Encoding utf8
$receipt | ConvertTo-Json -Compress
