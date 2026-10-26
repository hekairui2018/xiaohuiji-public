# nInfer compatibility and local validation — 2026-10-26

The expert adapter now detects the actual model discovery owner `ninfer`, uses the standard `json_schema` envelope with `anyOf` for the disjoint answer/clarify actions, and sends reasoning effort `none` when thinking is disabled. Other provider branches retain their behavior. nInfer must be started with `--structured-output`.

Only this compatibility increment was applied to the current public adapter; newer public instructions and behavior were preserved. Three synthetic provider checks passed against the public candidate: nInfer, llama.cpp, and Strata, each retaining one generation per message. The development deployment separately passed 18 existing expert checks, 14 model controller checks, two actual product questions and the streaming text/final protocol. No production service or business data was modified.

| Measurement | Result |
|---|---:|
| Original llama.cpp decoding | 26.2 tokens/s |
| nInfer plain decoding | 40.6 tokens/s |
| nInfer MTP3 decoding | 54.6 tokens/s |
| R712 expert response, original / nInfer development entry | 5.14 / 2.15 s |
| C16L expert response, nInfer development entry | 2.04 s |
| R712 streaming protocol, first text / completion | 1.29 / 1.59 s |

Hardware was an RTX 3060 12GB. Generation used the same prompt, 16K context and two 256-token requests per engine. The original PTQ1_0 GGUF with q4 KV differs from the PQ2-derived native model artifact with int8 KV; this compares working configurations, not bit-identical weights. Product questions are known regression samples, not blind accuracy evaluation. Stream events verify the response protocol, not visual browser acceptance. Latency varies by prompt, evidence, cache and load.

The local controller has an additional nInfer choice; a real off/on cycle released the model port and restored the remembered engine. Original model files and launch parameters were retained and configuration backups made before changes. These local machine paths and private receipts are intentionally excluded.
