# vLLM Multi-Model Setup for GB10 Spark

## Overview

The OpenClaw Swarm Platform supports a Docker-based vLLM server that allows flexible model selection and configuration. This document covers:

- Current vLLM deployment architecture
- Supported models and their characteristics
- Hardware requirements and GPU memory considerations
- How to switch between models
- Technical constraints on GB10 Spark (CUDA, FP8, etc.)

## Current vLLM Setup

### Architecture

- **Deployment**: Docker container (`nvcr.io/nvidia/vllm:25.12-py3`)
- **Container Management**: Single persistent container named `vllm-server`
- **Port**: Default 8000 (configurable)
- **Orchestration**: systemd/manual start via `scripts/start-vllm.sh` or `scripts/start-vllm-multi.sh`
- **Hardware**: GB10 Spark (DGX A100-80GB or H100) with ~120GB unified memory

### Key Flags

- `--enforce-eager`: Disables CUDA graph capture (see CUDA constraints below)
- `--enable-auto-tool-choice`: Auto-enables function calling where supported
- `--tool-call-parser hermes`: Parses tool calls in Hermes format
- `--gpu-memory-utilization`: Controls how much GPU memory vLLM can use (model and size dependent)

## Supported Models

All models below are in NVFP4 or MXFP4 quantization format, optimized for vLLM on NVIDIA hardware.

### Model Catalog

| Alias | Full Model ID | Size | Speed | Quality | Use Case | GPU Mem Util |
|-------|---------------|------|-------|---------|----------|--------------|
| `14b` (default) | `nvidia/Qwen3-14B-NVFP4` | 14B | Medium | High | Coordinator (best choice) | 0.7 |
| `8b` | `nvidia/Qwen3-8B-NVFP4` | 8B | Fast | Medium | General task work | 0.5 |
| `llama-8b` | `nvidia/Llama-3.1-8B-Instruct-NVFP4` | 8B | Fast | Medium | Task-specific reasoning | 0.5 |
| `gpt-20b` | `openai/gpt-oss-20b` | 20B | Medium | High | Fast + capable balance | 0.6 |
| `nemotron` | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | 120B (12B active MoE) | Slow | Highest | Maximum quality (Q&A) | 0.9 |

### Model Selection Guide

**For Coordinator/Integration roles**: Use `14b` (default) - balances quality and latency.

**For Speed-critical work (Research/Build)**: Use `8b` - sacrifices some quality but responds 2-3x faster.

**For Task-specific reasoning**: Use `llama-8b` - Llama has excellent instruction-following.

**For Balanced quality+speed**: Use `gpt-20b` - good middle ground between 8B and 14B.

**For Maximum quality (offline use)**: Use `nemotron` - 120B MoE with 12B active parameters. Slower but highest quality. Requires `--gpu-memory-utilization 0.9` and `--max-model-len 32768`.

## vLLM vs Ollama

### Why vLLM for Large Models

vLLM is optimized for production inference on NVIDIA GPUs. Key advantages over Ollama:

- **Quantization Support**: Handles NVFP4 and MXFP4 quantized models efficiently
- **GPU Memory**: Fine-grained control via `--gpu-memory-utilization` flag
- **Performance**: Better throughput on A100/H100 GPUs
- **Tool Calling**: Native support for structured output and function calling
- **Scaling**: Designed for concurrent requests with batching

### Why Ollama for Small Models

Ollama excels at local development with small models (<8B). Key advantages:

- **Ease of Use**: `ollama pull qwen2.5:7b && ollama serve`
- **Isolation**: Each model runs in separate process
- **Flexibility**: Works across architectures (CPU, AMD, NVIDIA)
- **Development**: Zero-configuration setup for testing

### Format Compatibility

- **NVFP4 models** (e.g., `nvidia/Qwen3-14B-NVFP4`): vLLM optimized, Ollama unavailable
- **MXFP4 models** (e.g., `openai/gpt-oss-20b`): vLLM optimized, Ollama unavailable
- **Standard GGUF** (e.g., `qwen2.5:14b`): Ollama optimized, vLLM available but less efficient
- **FP8 models**: vLLM supported but not recommended on GB10 (see constraints)

## GPU Memory Considerations

### GB10 Spark Hardware

- **Total unified memory**: ~120GB
- **Per-model headroom**: vLLM + CUDA runtime + model weights + KV cache
- **Concurrent models**: Can run Ollama + vLLM simultaneously if memory permits

### Memory Utilization Tuning

```bash
# Conservative (leaves room for other processes)
--gpu-memory-utilization 0.5   # 8B models, safe for Ollama + vLLM

# Balanced (default for 14B)
--gpu-memory-utilization 0.7   # 14B models, recommended default

# Aggressive (for 20B+)
--gpu-memory-utilization 0.8   # 20B models, monitor OOM

# Maximum (only for 120B MoE)
--gpu-memory-utilization 0.9 --max-model-len 32768  # 120B, leaves minimal headroom
```

### Monitoring

Check GPU memory during inference:

```bash
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,nounits -l 1
```

If OOM errors occur, reduce `--gpu-memory-utilization` by 0.1 and restart.

## Technical Constraints on GB10 Spark

### CUDA Stream Capture Issues

**Issue**: CUDA graph capture (vLLM's default inference mode) causes hangs on GB10 Spark hardware.

**Solution**: Use `--enforce-eager` flag (always on in start-vllm.sh and start-vllm-multi.sh).

- Forces eager execution instead of graph capture
- Slight latency penalty (~5-10%) but eliminates hangs
- Essential for production stability

### FP8 Quantization Not Recommended

**Issue**: FP8 models (e.g., `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8`) have CUDA stream capture issues on GB10 even with `--enforce-eager`.

**Status**: The Nemotron model in our catalog is FP8, but:
- Works with `--enforce-eager` on GB10
- May have edge cases; monitor logs for CUDA stream errors
- NVFP4 variants are preferred where available

**Alternative**: If issues arise, use NVFP4 variants (14B, 8B) which have no CUDA stream issues.

### GGUF Models on vLLM

Standard GGUF format (used by Ollama) can be served by vLLM but with reduced performance:
- No native GGUF optimization in vLLM
- NVFP4/MXFP4 models are always preferred
- Ollama remains the better choice for GGUF models

## How to Switch Models

### Using start-vllm-multi.sh

The new `start-vllm-multi.sh` script automates model switching with alias resolution and GPU memory tuning:

```bash
# List available models
./scripts/start-vllm-multi.sh --list-models

# Start with default (14b on port 8000)
./scripts/start-vllm-multi.sh

# Start with alias
./scripts/start-vllm-multi.sh --model 8b

# Start on different port
./scripts/start-vllm-multi.sh --model nemotron --port 8001

# Use full model ID directly
./scripts/start-vllm-multi.sh --model nvidia/Qwen3-14B-NVFP4 --port 8002
```

### Process

1. Stop existing vLLM container (script handles this)
2. Script resolves alias to full model ID
3. Script determines appropriate `--gpu-memory-utilization` based on model size
4. Docker pulls model from HuggingFace Hub if not cached
5. vLLM initializes, loads model into VRAM
6. Script waits for `/health` endpoint readiness (up to 5 minutes)
7. Server ready at `http://127.0.0.1:<PORT>/v1`

### Caching

Models are cached in Docker's image layer or HuggingFace cache:
- First run: ~2-5 minutes for model download + initialization
- Subsequent runs: ~30-60 seconds (cache hit)
- Cache location: `/root/.cache/huggingface/hub/` inside container

### No Runtime Model Swapping

Important: vLLM loads **one model per container instance**. There is no runtime model swapping API.

- To switch models: stop current container, start new one with different model
- To run multiple models simultaneously: start multiple containers on different ports
- Example: Coordinator on port 8000 (14b), Evaluator on port 8001 (8b)

## Integration with modelCatalog.js

The `src/modelCatalog.js` module discovers and ranks available models:

- **vLLM endpoint**: Queries `http://127.0.0.1:8000/v1/models` to discover loaded model
- **Ollama models**: Queries `ollama list` for local models
- **Role routing**: Selects best model for each role (research, build, critic, etc.)
- **Fallback**: Uses role preferences if exact model unavailable

If vLLM is running on port 8000, it will be automatically discovered and used as a high-quality tier option.

## Example Workflows

### Setup for Multi-Model Coordinator

Run coordinator on 14b (best quality):
```bash
./scripts/start-vllm-multi.sh --model 14b --port 8000
```

### Setup for Fast Research Loop

Run fast research on 8b:
```bash
./scripts/start-vllm-multi.sh --model 8b --port 8000
```

### Setup for Multi-Tier Evaluation

Run multiple models for different roles:
```bash
# Terminal 1: Coordinator on 14b
./scripts/start-vllm-multi.sh --model 14b --port 8000

# Terminal 2 (optional): Critic on 8b for speed
./scripts/start-vllm-multi.sh --model 8b --port 8001
```

Then in `src/server.js`, route by port or extend modelCatalog.js to discover both.

## Troubleshooting

### Port Already in Use

```bash
lsof -i :8000
kill -9 <PID>
# or
docker rm -f vllm-server
```

### Model Download Hangs

Increase readiness timeout in script or manually wait:
```bash
docker logs -f vllm-server
```

### Out of Memory (OOM)

Reduce `--gpu-memory-utilization`:
```bash
# Kill current
docker rm -f vllm-server

# Restart with lower memory
./scripts/start-vllm-multi.sh --model 14b  # uses 0.5 by default if memory is issue
```

### CUDA Errors in Logs

If you see CUDA stream capture errors despite `--enforce-eager`:
```bash
docker logs vllm-server | grep -i cuda
```

- Likely indicates hardware issue or unsupported operation
- Try smaller model (8b instead of 14b)
- Or switch from FP8 to NVFP4 variant if available

## References

- [vLLM Documentation](https://docs.vllm.ai/)
- [NVIDIA vLLM Container](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm)
- [Quantization Formats](https://huggingface.co/docs/transformers/quantization)
- [GB10 Spark Platform Guide](https://docs.nvidia.com/datacenter/dg/dg_vllm_on_spark.html)
