"""Reuse the native index embedder, without registering expert sources in that index."""
import hashlib
from pathlib import Path
from functools import lru_cache

@lru_cache(maxsize=2)
def model_digest(model_directory):
    return hashlib.sha256((Path(model_directory)/'model.onnx').read_bytes()).hexdigest()

def query_embedding(index, model_directory, query):
    if not isinstance(query,str) or not query.strip() or len(query)>512:
        raise ValueError('invalid-query')
    return {'vector':index.embed.encode([query])[0].tolist(),'modelSha256':model_digest(model_directory)}
