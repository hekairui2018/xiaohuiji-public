"""GPU preflight -> untouched baseline -> one-step smoke -> bounded LoRA -> same holdout.

Only adapter weights are saved. No production imports, requests or configuration.
"""
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT/'tmp/retrieval-lora-20261020'
CACHE = Path(tempfile.gettempdir())/'xhj-retrieval-lora-20261020'
for variable,folder in [('TRITON_CACHE_DIR','triton'),('TORCHINDUCTOR_CACHE_DIR','inductor'),('UNSLOTH_COMPILE_LOCATION','unsloth')]:
    os.environ.setdefault(variable,str(CACHE/folder))
os.environ.setdefault('HF_HOME',str(WORK/'hf-cache'))
os.environ.setdefault('UNSLOTH_CACHE_DIR',str(WORK/'unsloth-cache'))
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')
os.environ.setdefault('WANDB_DISABLED','true')
os.environ.setdefault('PYTHONUTF8','1')

import argparse
import gc
import hashlib
import importlib.metadata
import json
import statistics
import subprocess
import sys
import threading
import time

sys.stdout.reconfigure(encoding='utf-8')
from protocol import SYSTEM, compact, parse_raw, score


def dump(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def gpu():
    line=subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total,memory.used,memory.free','--format=csv,noheader,nounits'],text=True).splitlines()[0]
    name,total,used,free=[x.strip() for x in line.split(',')]
    return dict(name=name,total_mib=int(total),used_mib=int(used),free_mib=int(free))


class Monitor:
    def __init__(self):
        self.samples=[];self.stop=threading.Event()
    def start(self):
        def sample():
            while not self.stop.is_set():
                try:self.samples.append(dict(at=time.time(),**gpu()))
                except Exception:pass
                self.stop.wait(1)
        self.thread=threading.Thread(target=sample,daemon=True);self.thread.start()
    def finish(self):
        self.stop.set();self.thread.join(3)
        dump(WORK/'results/gpu-samples.json',self.samples)


def load_rows(split):
    rows=[json.loads(line) for line in (WORK/f'data/{split}.jsonl').read_text(encoding='utf-8').splitlines()]
    if any(r['status']!='policy_reviewed' or r['split']!=split for r in rows):
        raise ValueError('unreviewed-or-wrong-split')
    return rows


def encode_prompt(tokenizer,text):
    return tokenizer.apply_chat_template([dict(role='system',content=SYSTEM),dict(role='user',content=text)],tokenize=True,add_generation_prompt=True,enable_thinking=False)


def evaluate(model,tokenizer,rows,tag,torch):
    from unsloth import FastLanguageModel
    FastLanguageModel.for_inference(model)
    records=[]
    # Same unscored warmup for both models. No example target exposed.
    with torch.inference_mode():
        ids=torch.tensor([encode_prompt(tokenizer,'你好')],device='cuda')
        model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),max_new_tokens=8,do_sample=False,pad_token_id=tokenizer.eos_token_id)
    for row in rows:
        ids=torch.tensor([encode_prompt(tokenizer,row['customer'])],device='cuda')
        torch.cuda.synchronize();start=time.perf_counter()
        with torch.inference_mode():
            output=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),max_new_tokens=256,do_sample=False,pad_token_id=tokenizer.eos_token_id,use_cache=True)
        torch.cuda.synchronize();elapsed=time.perf_counter()-start
        tokens=output[0,ids.shape[1]:].tolist()
        text=tokenizer.decode(tokens,skip_special_tokens=True)
        record=dict(id=row['id'],customer=row['customer'],raw_output=text,output_tokens=len(tokens),input_tokens=ids.shape[1],elapsed_s=elapsed,tokens_per_s=len(tokens)/elapsed,review_status=row['status'],hit_output_limit=len(tokens)>=256)
        try:json.loads(text.strip());record['valid_json']=True
        except ValueError:record['valid_json']=False
        try:record['parsed']=parse_raw(text);record['scores']=score(record['parsed'],row);record['protocol_valid']=True
        except (ValueError,TypeError,KeyError) as error:record['protocol_valid']=False;record['error']=str(error)
        records.append(record)
        # Persist every original output, including a partially completed run.
        dump(WORK/f'results/{tag}.raw.json',records)
        print(compact(dict(event='evaluation',tag=tag,id=row['id'],valid=record['valid_json'],strict=record.get('scores',{}).get('strict',False),seconds=round(elapsed,3))),flush=True)
    n=len(records)
    summary=dict(n=n,json_valid_rate=sum(r['valid_json'] for r in records)/n,protocol_valid_rate=sum(r['protocol_valid'] for r in records)/n,mean_latency_s=statistics.mean(r['elapsed_s'] for r in records),
                 aggregate_tokens_per_s=sum(r['output_tokens'] for r in records)/sum(r['elapsed_s'] for r in records),
                 mean_output_tokens=statistics.mean(r['output_tokens'] for r in records),
                 output_under_100_rate=sum(r['output_tokens']<=100 for r in records)/n,
                 metrics={k:sum(r.get('scores',{}).get(k,False) for r in records)/n for k in ['action','kind','models','chips','version','keywords','strict']})
    eligible={
        'search_kind':[i for i,r in enumerate(rows) if r['target']['action']=='search'],
        'nonempty_models':[i for i,r in enumerate(rows) if r['target'].get('models')],
        'nonempty_chips':[i for i,r in enumerate(rows) if r['target'].get('chips')],
        'specified_version':[i for i,r in enumerate(rows) if r['target'].get('version')],
    }
    metric_for={'search_kind':'kind','nonempty_models':'models','nonempty_chips':'chips','specified_version':'version'}
    summary['applicable_metrics']={k:dict(n=len(indices),rate=sum(records[i].get('scores',{}).get(metric_for[k],False) for i in indices)/len(indices) if indices else None) for k,indices in eligible.items()}
    dump(WORK/f'results/{tag}.summary.json',summary)
    return summary


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=36);args=parser.parse_args()
    if (WORK/'adapter/adapter_model.safetensors').exists():
        raise RuntimeError('Existing adapter preserved. Use a separate experiment directory for a new training run.')
    preflight=gpu();dump(WORK/'results/preflight.json',preflight)
    if preflight['free_mib']<6500:
        raise RuntimeError('需要至少6500MiB空闲显存；已停止实验，不结束任何现有服务')
    monitor=Monitor();monitor.start()
    try:
        # Import Unsloth before transformers/peft. Base is official FP safetensors.
        from unsloth import FastLanguageModel
        import torch
        from transformers import Trainer,TrainingArguments,DataCollatorForSeq2Seq,set_seed
        from datasets import Dataset
        set_seed(3407)
        dump(WORK/'results/environment.json',dict(python=sys.version,torch=torch.__version__,cuda=torch.version.cuda,gpu=torch.cuda.get_device_name(0),versions={n:importlib.metadata.version(n) for n in ['unsloth','unsloth_zoo','transformers','peft','datasets','trl','triton-windows']}))
        train,validation,test=map(load_rows,['train','validation','test'])
        if set(r['group_id'] for r in train)&set(r['group_id'] for r in test):raise ValueError('holdout-leakage')
        model,tokenizer=FastLanguageModel.from_pretrained(model_name=str(WORK/'base-model'),max_seq_length=512,dtype=torch.bfloat16,load_in_4bit=False,full_finetuning=False,local_files_only=True,trust_remote_code=False)
        baseline=evaluate(model,tokenizer,test,'baseline',torch)
        # Holdout results are not used to tune training steps or learning rate.
        model=FastLanguageModel.get_peft_model(model,r=8,target_modules=['q_proj','k_proj','v_proj','o_proj','gate_proj','up_proj','down_proj'],lora_alpha=16,lora_dropout=0,bias='none',use_gradient_checkpointing='unsloth',random_state=3407)
        encoded=[]
        for row in train:
            prefix=encode_prompt(tokenizer,row['customer'])
            target=tokenizer.encode(compact(row['target'])+tokenizer.eos_token,add_special_tokens=False)
            ids=prefix+target
            if len(ids)>512:raise ValueError(f'No silent training truncation: {row["id"]} length {len(ids)}')
            encoded.append(dict(input_ids=ids,attention_mask=[1]*len(ids),labels=[-100]*len(prefix)+target))
        dataset=Dataset.from_list(encoded)
        from transformers import TrainerCallback
        class Receipt(TrainerCallback):
            def on_step_end(self,training_args,state,control,**kwargs):
                if state.global_step==1:
                    dump(WORK/'results/smoke.json',dict(passed=True,optimizer_steps=1,training_rows=len(train),cuda_allocated_mib=torch.cuda.memory_allocated()/2**20))
                    print('MINIMUM_TRAINING_PASSED',flush=True)
        FastLanguageModel.for_training(model)
        torch.cuda.reset_peak_memory_stats();start=time.perf_counter()
        trainer=Trainer(model=model,train_dataset=dataset,data_collator=DataCollatorForSeq2Seq(tokenizer,padding=True,label_pad_token_id=-100,pad_to_multiple_of=8),
                        args=TrainingArguments(output_dir=str(WORK/'trainer-work'),per_device_train_batch_size=1,gradient_accumulation_steps=4,max_steps=args.steps,learning_rate=2e-4,warmup_steps=2,lr_scheduler_type='linear',optim='adamw_torch',bf16=True,fp16=False,logging_steps=1,save_strategy='no',report_to='none',seed=3407,data_seed=3407,dataloader_num_workers=0,dataloader_pin_memory=False,remove_unused_columns=False),callbacks=[Receipt()])
        receipt=trainer.train()
        elapsed=time.perf_counter()-start
        adapter=WORK/'adapter';model.save_pretrained(str(adapter),safe_serialization=True);tokenizer.save_pretrained(str(adapter))
        training=dict(data_rows=len(train),validation_rows=len(validation),test_rows=len(test),optimizer_steps=trainer.state.global_step,micro_batch=1,gradient_accumulation=4,max_sequence=512,rank=8,thinking=False,train_seconds=elapsed,peak_allocated_mib=torch.cuda.max_memory_allocated()/2**20,peak_reserved_mib=torch.cuda.max_memory_reserved()/2**20,metrics=receipt.metrics,loss_history=trainer.state.log_history)
        dump(WORK/'results/training.json',training)
        del trainer;gc.collect();torch.cuda.empty_cache()
        tuned=evaluate(model,tokenizer,test,'lora',torch)
        # Validation is reported separately; never used to amend holdout labels.
        evaluate(model,tokenizer,validation,'lora-validation',torch)
        dump(WORK/'results/comparison.json',dict(baseline=baseline,lora=tuned,training=training,strict_delta=tuned['metrics']['strict']-baseline['metrics']['strict'],review_manifest_sha256=hashlib.sha256((WORK/'data/candidates.jsonl').read_bytes()).hexdigest(),limitations=['16条独立合成明确意图测试，不能等同真实工程判断验收','20条真实故障待人工审核，未参与训练及主评分','baseline与LoRA使用同一未见测试集、相同提示词和生成参数，无JSON修复或强制语法']))
    finally:monitor.finish()


if __name__=='__main__':
    main()
