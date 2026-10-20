"""CPU-only integrity and tokenizer checks. Does not load a model or train."""
import collections
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / 'tmp/qwen35-08b-base'
AUDIT = ROOT / 'tmp/qwen35-download-cache'

def main():
    manifest = json.loads((AUDIT/'download-manifest.json').read_text(encoding='utf-8'))
    verified = []
    for record in manifest['files']:
        file = DEST / record['file']
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert file.stat().st_size == record['bytes']
        assert digest == record['sha256'], file.name
        verified.append(file.name)
    assert not list(DEST.rglob('*.gguf'))
    assert not list(DEST.rglob('*.partial'))
    config = json.loads((DEST/'config.json').read_text(encoding='utf-8'))
    assert config['model_type'] == 'qwen3_5'
    assert not config.get('quantization_config')
    index = json.loads((DEST/'model.safetensors.index.json').read_text(encoding='utf-8'))
    tensor_keys = {}
    dtypes = collections.Counter()
    parameters = 0
    for name in sorted(set(index['weight_map'].values())):
        file = DEST / name
        with file.open('rb') as stream:
            header_bytes = struct.unpack('<Q', stream.read(8))[0]
            header = json.loads(stream.read(header_bytes))
        end = 0
        for key, tensor in sorted(((k, v) for k, v in header.items() if k != '__metadata__'),
                                  key=lambda item: item[1]['data_offsets'][0]):
            begin, finish = tensor['data_offsets']
            assert begin == end and finish >= begin
            end = finish
            count = 1
            for dimension in tensor['shape']:
                count *= dimension
            width = {'BF16':2, 'F16':2, 'F32':4, 'I64':8, 'I32':4, 'BOOL':1}[tensor['dtype']]
            assert finish-begin == count*width
            tensor_keys[key] = name
            dtypes[tensor['dtype']] += 1
            parameters += count
        assert file.stat().st_size == 8+header_bytes+end
    assert tensor_keys == index['weight_map'], 'Index/header key mismatch'
    assert dtypes['BF16'] > 0
    assert set(dtypes).issubset({'BF16', 'F32', 'I64', 'I32', 'BOOL'})
    from transformers import AutoConfig, AutoTokenizer
    auto_config = AutoConfig.from_pretrained(str(DEST), local_files_only=True, trust_remote_code=False)
    tokenizer = AutoTokenizer.from_pretrained(str(DEST), local_files_only=True, trust_remote_code=False)
    sample = 'A5L刚升级后局部闪烁，第一步查什么资料？'
    encoded = tokenizer.encode(sample, add_special_tokens=False)
    assert tokenizer.decode(encoded) == sample
    prompt = tokenizer.apply_chat_template([{'role':'user', 'content':sample}],
                  tokenize=False, add_generation_prompt=True, enable_thinking=False)
    assert sample in prompt
    for name in ['tokenizer_config.json', 'preprocessor_config.json', 'video_preprocessor_config.json']:
        json.loads((DEST/name).read_text(encoding='utf-8'))
    result = dict(model=manifest['model'], source=manifest['source'], files_verified=len(verified),
                  total_bytes=sum(r['bytes'] for r in manifest['files']),
                  weight_sha256=manifest['official_hf_weight_sha256'],
                  tensor_count=len(tensor_keys), tensor_dtypes=dict(dtypes), stored_parameter_elements=parameters,
                  config_class=type(auto_config).__name__, tokenizer_class=type(tokenizer).__name__,
                  tokenizer_roundtrip=True, chat_template_no_thinking=True,
                  intended_training={'method':'LoRA', 'dtype':'bfloat16', 'bf16':True,
                                     'load_in_4bit':False,'load_in_8bit':False,'QLoRA':False},
                  gpu_model_loaded=False, training_started=False)
    (AUDIT/'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
