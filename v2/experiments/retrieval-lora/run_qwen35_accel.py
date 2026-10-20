"""Bound the one kernel warmup attempt; rerun the unchanged benchmark with FLA."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/qwen35-accel'
OUT=WORK/'benchmark'
OUT.mkdir(exist_ok=True)
env=os.environ.copy()
base=ROOT/'tmp/retrieval-lora-20261020/venv/Lib/site-packages/triton'
cache=Path(tempfile.gettempdir())/'xhj-qwen35-fla'
env.update(CUDA_PATH=str(base/'backends/nvidia'),CC=str(base/'runtime/tcc/tcc.exe'),
    TRITON_CACHE_DIR=str(cache/'triton'),TORCHINDUCTOR_CACHE_DIR=str(cache/'inductor'),
    PYTHONUTF8='1',PYTHONIOENCODING='utf-8')
status=WORK/'status.json'
status.write_text(json.dumps({'stage':'probe','timeout_seconds':180}),encoding='utf-8')
try:
    with (WORK/'probe.stdout.log').open('w',encoding='utf-8') as out, (WORK/'probe.stderr.log').open('w',encoding='utf-8') as err:
        subprocess.run([sys.executable,'-X','utf8',str(Path(__file__).with_name('probe_qwen35_fla.py'))],
                       env=env,stdout=out,stderr=err,timeout=180,check=True)
except Exception as exc:
    status.write_text(json.dumps({'stage':'stopped','reason':str(exc),'source_build_attempted':False}),encoding='utf-8')
    raise
status.write_text(json.dumps({'stage':'benchmark','kernel_verification':True}),encoding='utf-8')
os.environ.update(env)
import benchmark_qwen35_bf16 as benchmark
benchmark.OUT=OUT
benchmark.main()
status.write_text(json.dumps({'stage':'complete','kernel_verification':True}),encoding='utf-8')
