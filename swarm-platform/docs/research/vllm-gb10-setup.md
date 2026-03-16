# vLLM Setup on NVIDIA DGX Spark GB10

## Status

**Working method**: NVIDIA official Docker container `nvcr.io/nvidia/vllm:26.02-py3`

**Command**:
```bash
./scripts/start-vllm.sh
# or directly:
docker run -d --gpus all --ipc=host -p 8000:8000 --name vllm-server \
  nvcr.io/nvidia/vllm:25.11-py3 vllm serve nvidia/Qwen3-14B-FP8 \
  --gpu-memory-utilization 0.7 --enforce-eager
```

**Note**: Use image `25.11-py3` not `26.02-py3`. The 26.02 image requires CUDA driver 590 which the DGX Spark currently ships with driver 580.

## Known Limitation: pip-based vLLM Does Not Work on GB10

**Root cause**: The DGX Spark uses an NVIDIA GB10 Blackwell chip with CUDA Compute Capability 12.1.
PyTorch stable wheels (including `+cu130`) support only up to CC 12.0. The pip-installed vLLM 0.17.1
is compiled against CUDA 12 (`libcudart.so.12`) but the system ships CUDA 13.0.

**Failure chain**:
1. `pip install vllm` resolves to CPU-only torch on aarch64 PyPI
2. Force-installing `torch-2.10.0+cu130-cp312-cp312-manylinux_2_28_aarch64.whl` succeeds but warns:
   *"GB10 is cuda capability 12.1, max supported is 12.0"*
3. vLLM's C extensions link against `libcudart.so.12` (CUDA 12 SONAME) — the system only has `libcudart.so.13`
4. Even with Ollama's bundled `libcudart.so.12` (v12.8.90) in LD_LIBRARY_PATH, Triton JIT fails:
   - Triton tries to compile `cuda_utils.c` as a Python C extension
   - Requires `Python.h` from `libpython3.12-dev` which is not installed
   - Cannot install `libpython3.12-dev` without sudo
5. Even if Python headers were available, Triton's compiled CUDA kernels would not
   support CC 12.1 operations specific to Blackwell architecture

**Resolution**: Use NVIDIA's official container which has:
- PyTorch built for GB10 / Blackwell CC 12.1
- vLLM compiled against the correct CUDA 13 runtime
- FP8 quantization support (Blackwell hardware FP8)
- All Python headers pre-installed inside the container

## Supported Models (from https://build.nvidia.com/spark/vllm)

| Model | Notes |
|-------|-------|
| `nvidia/Qwen3-14B-FP8` | **Primary** — best coordinator/evaluator model |
| `nvidia/Qwen3-8B-FP8` | Faster alternative for research/build agents |
| `nvidia/Llama-3.1-8B-Instruct-FP8` | Llama FP8 |
| `nvidia/Nemotron-Super-49B-v1-FP8` | Large reasoning model |

## Configuration

**openclaw.json** (provider `dgx-vllm`):
```json
"dgx-vllm": {
  "baseUrl": "http://127.0.0.1:8000/v1",
  "api": "openai-completions",
  "models": [{ "id": "nvidia/Qwen3-14B-FP8", ... }]
}
```

**Coordinator/evaluator/integrator** in `openclaw.json` agents section:
```json
"primary": "dgx-vllm/nvidia/Qwen3-14B-FP8",
"fallback": "ollama/qwen2.5:14b"
```

## Expected Performance

FP8 Qwen3-14B on GB10 (121GB unified memory, Blackwell): ~200-400 tok/s vs Ollama's ~10 tok/s.
This is a ~20-40× speedup for the coordinator/evaluator pipeline, dramatically reducing round time.
