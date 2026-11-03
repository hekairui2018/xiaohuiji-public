# Native retrieval and memory protection

The dependency watchdog now manages the model service only. Removed legacy Docker, RAGFlow, and container embedding startup/probe paths. Native section retrieval continues to run its CPU ONNX embedder in the resource-index process.

Free-memory pause thresholds are now 256 MiB GPU memory and 512 MiB host memory. The model schedule preflight uses the same limits; GPU temperature remains 85 degrees Celsius. These thresholds control pausing and do not reduce model allocations. Persistent fault latching, inference cancellation and model error handling are retained.

Validation: 18 protection/concurrency/queue tests passed, including exact memory boundaries and one MiB below. Development deployment changed one protected backend module and preserved the other 269 modules and frontend. With all five legacy containers stopped, native retrieval returned six results with vectorUsed=true. The watchdog ran with no errors and reported the model healthy. This does not assert answer correctness or a specific amount of reclaimed host RAM.

The existing historical GPU probe fault remains latched on the main expert endpoint; no automatic fault reset was introduced. Original documents, indexes, model weights and container volumes were retained. Rollback configuration and the preceding runtime are retained locally.
