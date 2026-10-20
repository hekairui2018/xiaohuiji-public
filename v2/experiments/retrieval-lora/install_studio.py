"""Install Studio separately; never modify the existing experiment environment."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "tmp/unsloth-studio-20261020"
TRAIN = ROOT / "tmp/retrieval-lora-20261020"
DEST.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
           UV_CACHE_DIR=str(TRAIN / "uv-cache"), UV_HTTP_TIMEOUT="60",
           UV_DEFAULT_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple")
python = DEST / "home/studio/unsloth_studio/Scripts/python.exe"
uv = TRAIN / "venv/Scripts/uv.exe"
status = DEST / "install-status.json"

def record(stage, **details):
    status.write_text(json.dumps(dict(stage=stage, time=time.time(), **details), indent=2), encoding="utf-8")

def run(stage, args):
    record(stage)
    print(stage, flush=True)
    subprocess.run([str(a) for a in args], env=env, check=True)

try:
    if not python.exists():
        run("create-isolated-environment", [sys.executable, "-m", "venv", python.parents[1]])
    run("install-cached-cuda-runtime", [uv, "pip", "install", "--python", python,
        TRAIN / "wheels/torch-2.10.0+cu130-cp312-cp312-win_amd64.whl", "torchao==0.15.0"])
    run("install-studio", [uv, "pip", "install", "--python", python,
        "unsloth[studio]==2026.10.7", "unsloth_zoo==2026.10.7", "torch==2.10.0+cu130",
        "torchvision==0.25.0", "xformers==0.0.34", "triton-windows==3.6.0.post26",
        "torchao==0.15.0"])
    with (DEST / "requirements.lock.txt").open("w", encoding="utf-8") as f:
        subprocess.run([str(uv), "pip", "freeze", "--python", str(python)], env=env, stdout=f, check=True)
    record("complete")
except Exception as exc:
    record("failed", error=str(exc))
    raise
