$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$experimentRoot = Join-Path $projectRoot 'tmp/retrieval-lora-20261020'
$environmentRoot = Join-Path $experimentRoot 'venv'
New-Item -ItemType Directory -Force $experimentRoot | Out-Null
if (!(Test-Path (Join-Path $environmentRoot 'pyvenv.cfg'))) {
    python -m venv $environmentRoot
    if ($LASTEXITCODE) { throw 'Could not create isolated environment' }
}
$experimentPython = Join-Path $environmentRoot 'Scripts/python.exe'
$experimentUv = Join-Path $environmentRoot 'Scripts/uv.exe'
$env:UV_CACHE_DIR = Join-Path $experimentRoot 'uv-cache'
$env:PYTHONUTF8 = '1'
& $experimentPython -m pip install uv
if ($LASTEXITCODE) { throw 'uv bootstrap failed' }
# torchao must be resolved from PyPI before the CUDA index on Windows.
& $experimentUv pip install --python $experimentPython 'torchao==0.15.0'
if ($LASTEXITCODE) { throw 'torchao setup failed' }
& $experimentUv pip install --python $experimentPython 'unsloth==2026.10.7' 'torch==2.10.0' 'torchvision==0.25.0' 'xformers==0.0.34' 'triton-windows==3.6.0.post26' --torch-backend=cu130
if ($LASTEXITCODE) { throw 'GPU training environment install failed' }
& $experimentUv pip freeze --python $experimentPython | Set-Content -Encoding utf8 (Join-Path $experimentRoot 'requirements.lock.txt')
& $experimentPython -c "import torch; print(torch.__version__, torch.cuda.is_available()); assert torch.cuda.is_available()"
if ($LASTEXITCODE) { throw 'CUDA smoke failed; existing services were not stopped' }
