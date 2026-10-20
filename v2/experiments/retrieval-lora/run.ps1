param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$experimentRoot = Join-Path $projectRoot 'tmp/retrieval-lora-20261020'
$experimentPython = Join-Path $experimentRoot 'venv/Scripts/python.exe'
$env:PYTHONUTF8 = '1'
if ($Install) { & (Join-Path $PSScriptRoot 'setup.ps1') }
Push-Location $projectRoot
try {
    $preparation = @('fetch_model.py')
    if (!(Test-Path (Join-Path $experimentRoot 'data/candidates.jsonl'))) { $preparation += 'build_data.py' }
    $preparation += 'test_protocol.py'
    foreach ($script in $preparation) {
        & $experimentPython -B (Join-Path $PSScriptRoot $script)
        if ($LASTEXITCODE) { throw "Failed: $script" }
    }
    node (Join-Path $PSScriptRoot 'compatibility.cjs')
    if ($LASTEXITCODE) { throw 'V2 protocol contract failed' }
    if (!(Test-Path (Join-Path $experimentRoot 'adapter/adapter_model.safetensors'))) {
        & $experimentPython -u (Join-Path $PSScriptRoot 'experiment.py') --steps 36
        if ($LASTEXITCODE) { throw 'Experiment failed: inspect raw results; no automatic epoch increase' }
    }
    & $experimentPython -B (Join-Path $PSScriptRoot 'summarize.py')
    if ($LASTEXITCODE) { throw 'Independent raw-output scoring failed' }
    & $experimentPython -u (Join-Path $PSScriptRoot 'verify_interface.py')
    if ($LASTEXITCODE) { throw 'Isolated interface failed' }
    node (Join-Path $PSScriptRoot 'verify_dispatch.cjs')
    if ($LASTEXITCODE) { throw 'Existing read-only tool dispatch compatibility failed' }
} finally { Pop-Location }
