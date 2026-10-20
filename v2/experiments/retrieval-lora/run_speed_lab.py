"""Serial one-factor benchmarks, bounded incompatibility probes, full winner retest."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'tmp/qwen35-speed-lab'
SCRIPT=Path(__file__).with_name('speed_lab.py')
OLD=ROOT/'tmp/qwen35-accel/venv/Scripts/python.exe'
NEW=WORK/'venv/Scripts/python.exe'
outcomes=[]
def status(stage,**extra):
    (WORK/'suite-status.json').write_text(json.dumps(dict(stage=stage,outcomes=outcomes,**extra),indent=2),encoding='utf-8')
def run(name,mode,python,quick=False,timeout=600):
    status('running',case=name)
    command=[str(python),'-X','utf8',str(SCRIPT),'--mode',mode,'--name',name]
    if quick:command.append('--quick')
    started=time.time()
    with (WORK/f'{name}.stdout.log').open('w',encoding='utf-8') as stdout,(WORK/f'{name}.stderr.log').open('w',encoding='utf-8') as stderr:
        proc=subprocess.Popen(command,stdout=stdout,stderr=stderr,cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW,
                              env={**os.environ,'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8'})
        try:code=proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True)
            code=-1
    summary_path=WORK/'results'/name/'summary.json'
    record=dict(name=name,mode=mode,quick=quick,exit_code=code,seconds=time.time()-started)
    if code==0 and summary_path.exists():record.update(json.loads(summary_path.read_text()))
    else:record['error_tail']=(WORK/f'{name}.stderr.log').read_text(encoding='utf-8')[-3500:]
    outcomes.append(record)
    status('between_cases')
    return code==0

if __name__=='__main__':
    run('01_fla_hf','hf',OLD)
    run('02_fla_conv_hf','hf',NEW)
    run('03_no_penalty','bare',NEW)
    run('04_manual_dynamic','manual',NEW)
    if run('05_static_probe','static',NEW,quick=True,timeout=120):
        run('05_static','static',NEW)
        if run('06_graph_probe','graph',NEW,quick=True,timeout=180):
            run('06_graph','graph',NEW)
            if run('07_graph8_probe','graph_multi',NEW,quick=True,timeout=180):run('07_graph8','graph_multi',NEW)
        if run('08_compile_probe','compile',NEW,quick=True,timeout=240):run('08_compile','compile',NEW)
    full=[r for r in outcomes if not r['quick'] and r['exit_code']==0 and r.get('runs')==12]
    assert full,'No successful full benchmark'
    winner=max(full,key=lambda r:r['aggregate_tokens_per_s'])
    run('09_winner_retest',winner['mode'],OLD if winner['name']=='01_fla_hf' else NEW)
    status('complete',winner=winner['name'])
