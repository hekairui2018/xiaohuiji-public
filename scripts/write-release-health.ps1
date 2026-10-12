param([Parameter(Mandatory=$true)][int]$Port, [int]$PreviousPid=0)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outFile = Join-Path $projectRoot "tmp\release-health-$Port.json"
$healthPath = if ($Port -eq 3790) { '/health' } else { '/api/health' }
$expected = Get-Content -LiteralPath (Join-Path $projectRoot 'release-info.json') -Raw | ConvertFrom-Json
$lastError = ''
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port$healthPath" -TimeoutSec 3
        if (-not $health.ok) { throw 'health.ok is false' }
        if ($health.release.commit -ne $expected.commit -or $health.release.version -ne $expected.version) {
            throw 'Running version does not match release manifest'
        }
        if ($PreviousPid -gt 0 -and $health.pid -eq $PreviousPid) { throw 'Service was not restarted' }
        if ($Port -eq 3790 -and -not $health.authenticated) { throw 'WeCom not authenticated yet' }
        $result = @{ ok=$true; port=$Port; previous_pid=$PreviousPid; checked_at=(Get-Date -Format o); health=$health }
        $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outFile -Encoding UTF8
        exit 0
    } catch { $lastError = $_.Exception.Message }
    Start-Sleep -Seconds 2
}
@{ ok=$false; port=$Port; previous_pid=$PreviousPid; checked_at=(Get-Date -Format o); error=$lastError } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $outFile -Encoding UTF8
exit 1
