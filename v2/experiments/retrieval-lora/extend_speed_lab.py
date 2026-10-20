"""After the initial suite, test one extra factor: capture the compiled decoder."""
import json
import time
from pathlib import Path
import run_speed_lab as lab

deadline=time.monotonic()+900
while time.monotonic()<deadline:
    state=json.loads((lab.WORK/'suite-status.json').read_text(encoding='utf-8'))
    if state['stage']=='complete':break
    time.sleep(5)
else:raise TimeoutError('Initial suite did not finish')
lab.outcomes.extend(state['outcomes'])
if any(r['name']=='08_compile' and r['exit_code']==0 for r in lab.outcomes):
    if lab.run('10_compile_graph_probe','compile_graph',lab.NEW,quick=True,timeout=180):
        lab.run('10_compile_graph','compile_graph',lab.NEW)
        if lab.run('11_compile_graph8_probe','compile_graph8',lab.NEW,quick=True,timeout=180):
            lab.run('11_compile_graph8','compile_graph8',lab.NEW)
full=[r for r in lab.outcomes if not r['quick'] and r['exit_code']==0 and r.get('runs')==12 and r['name'] not in ['09_winner_retest','12_final_retest']]
winner=max(full,key=lambda r:r['aggregate_tokens_per_s'])
lab.run('12_final_retest',winner['mode'],lab.OLD if winner['name']=='01_fla_hf' else lab.NEW)
lab.status('complete',winner=winner['name'],extended_suite=True)
