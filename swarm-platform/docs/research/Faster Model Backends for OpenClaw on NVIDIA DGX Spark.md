# Faster Model Backends for OpenClaw on NVIDIA DGX Spark

## Overview

This document explains whether OpenClaw has an officially released "faster" solution for NVIDIA DGX Spark beyond Ollama, and how to configure high‑performance model backends without breaking compatibility. It focuses on:

- What OpenClaw actually supports today in terms of providers and backends.
- How NVIDIA’s DGX Spark guidance wires OpenClaw to local engines like LM Studio and Ollama.
- How to adapt the same mechanism to vLLM, TensorRT‑LLM, or SGLang while keeping the OpenClaw integration stable.

The key idea is that **OpenClaw talks to HTTP providers, not to GPU engines directly**. Engines like vLLM or TensorRT‑LLM are fine as long as they expose an OpenAI‑compatible or Anthropic‑compatible HTTP API, either directly or via a small gateway.[^1][^2]

***

## What OpenClaw Officially Supports Today

### Built‑in and Recommended Providers

Recent OpenClaw model guides describe a two‑layer model system:

- **Provider layer** – Anthropic, OpenAI, Google Gemini, DeepSeek, Ollama (local), OpenRouter, etc.[^1]
- **Model layer** – Specific models such as `claude-sonnet-3.5`, `gpt-4o`, `deepseek-v4`, `qwen-2.5-32b`, etc.[^1]

For local models, the documentation and ecosystem articles explicitly mention **Ollama** and **LM Studio** as first‑class local options, especially on RTX and DGX Spark hardware.[^3][^4][^5]

Key points:

- **Ollama integration** is tightly documented and even has a one‑command launcher (`ollama launch openclaw`) that installs and configures OpenClaw automatically and presents a model picker.[^4][^5]
- **LM Studio** can serve as an OpenAI‑compatible provider at `http://localhost:1234/v1` and is shown in NVIDIA’s DGX Spark + OpenClaw guide as a recommended path for GPT‑OSS models.[^3]
- OpenClaw can also use cloud providers (Anthropic, OpenAI, Google, DeepSeek, OpenRouter, etc.) via native provider definitions.

There is **no official first‑party module where OpenClaw “knows” about vLLM or TensorRT‑LLM directly**. Instead, the recommended approach is:

> Add any engine that exposes an OpenAI‑style HTTP endpoint as a **custom provider** in `models.providers` and allowlist its models.[^6][^2]

### Custom Provider Mechanism

The custom provider guide shows how to add any OpenAI‑compatible API to OpenClaw using a small JSON block.[^2][^6]

Structure (simplified):

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "your-provider-name": {
        "baseUrl": "http://host:port/v1",
        "apiKey": "optional-or-fake-key",
        "api": "openai-completions",   
        "models": [
          {
            "id": "model-id",
            "name": "Model Name",
            "reasoning": true,
            "input": ["text"],
            "contextWindow": 128000,
            "maxTokens": 32000,
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "models": {
        "your-provider-name/model-id": {
          "alias": "short-alias"
        }
      }
    }
  }
}
```

Important details:[^6]

- `baseUrl` is your HTTP server (LM Studio, vLLM gateway, Triton proxy, etc.).
- `api` must be `"openai-completions"` or a similar supported API type.
- `models[].id` must match the `model` field expected by the backend.
- The model must also be allowlisted under `agents.defaults.models` (or per‑agent models) using the fully‑qualified key `provider/model-id`.

This mechanism is what you will use to hook in faster DGX Spark backends.

***

## NVIDIA DGX Spark + OpenClaw Official Guidance

NVIDIA’s DGX Spark material and partner guides provide step‑by‑step integration examples that are already tuned for local performance.[^7][^8][^3]

### LM Studio Example (DGX Spark)

The NVIDIA DGX Spark + OpenClaw guide shows LM Studio serving GPT‑OSS models with an OpenAI‑style API:[^8][^3]

1. **Run the model in LM Studio**

   ```bash
   lms get openai/gpt-oss-20b
   lms load openai/gpt-oss-20b --context-length 32768
   ```

2. **Configure OpenClaw `models.providers` for LM Studio**

   ```json
   {
     "models": {
       "mode": "merge",
       "providers": {
         "lmstudio": {
           "baseUrl": "http://localhost:1234/v1",
           "apiKey": "lmstudio",
           "api": "openai-responses",
           "models": [
             {
               "id": "openai/gpt-oss-20b",
               "name": "openai/gpt-oss-20b",
               "reasoning": false,
               "input": ["text"],
               "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
               "contextWindow": 32768,
               "maxTokens": 4096
             }
           ]
         }
       }
     }
   }
   ```

3. **Allowlist the model for agents**

   ```json
   {
     "agents": {
       "defaults": {
         "models": {
           "lmstudio/openai/gpt-oss-20b": {
             "alias": "gpt-oss-20b"
           }
         }
       }
     }
   }
   ```

This pattern is identical to what you would do for a vLLM or TensorRT‑LLM endpoint; only `baseUrl`, `api`, and `id` change.

### Ollama Example (Local GPU)

The same NVIDIA and ecosystem docs show Ollama configured as:[^5][^4]

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434",
        "apiKey": "ollama-local",
        "api": "ollama",
        "models": [
          {
            "id": "gpt-oss:20b",
            "name": "GPT-OSS 20B",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 8192,
            "maxTokens": 81920
          }
        ]
      }
    }
  }
}
```

Again, the important bit is that OpenClaw is agnostic about *how* `gpt-oss:20b` is served; it only knows it calls an HTTP API at `baseUrl`.

***

## Is There a DGX‑Specific “Faster” Stack Shipped by OpenClaw?

There is **no OpenClaw release that ships a hard‑coded vLLM or TensorRT‑LLM stack specifically for DGX Spark**. Instead:

- NVIDIA’s DGX Spark materials show how to run GPT‑OSS 20B/120B efficiently with **SGLang** (and by implication vLLM / TensorRT‑LLM) and then hook that into chat frontends like Open WebUI.[^9][^7]
- OpenClaw’s own ecosystem docs encourage using **custom providers** to connect any OpenAI‑compatible engine, including local runtimes like vLLM, LM Studio, and text‑generation‑webui.[^2]
- NVIDIA’s OpenClaw on RTX/DGX guide explicitly treats LM Studio and Ollama as the main local paths, but the JSON pattern is generic and can be reused for any backend that mimics the OpenAI API.[^3]

So the answer is: **OpenClaw already exposes the abstraction you need; DGX‑optimised engines are plugged in via custom providers rather than baked into OpenClaw itself.**

This is actually good news — it means you can choose whichever engine is best for your DGX Spark without waiting for an OpenClaw release.

***

## Adapting vLLM or TensorRT‑LLM to OpenClaw Safely

### 1. Expose an OpenAI‑Compatible Endpoint

vLLM and TensorRT‑LLM themselves are low‑level engines, but several projects wrap them with OpenAI‑style HTTP servers.[^10][^11]

Options include:

- **vLLM’s own OpenAI server mode** – run `python -m vllm.entrypoints.openai.api_server ...` with your model weights.[^12]
- **TensorRT‑LLM via TGI or Triton** – use a higher‑level serving stack (e.g., Hugging Face TGI with TRT‑LLM backend) and enable its OpenAI‑compatible API mode.[^11][^10]
- **LiteLLM as a proxy** – sit LiteLLM in front of vLLM/TRT‑LLM and let LiteLLM expose OpenAI‑style endpoints; OpenClaw then talks only to LiteLLM as the provider.[^6][^2]

Your goal is to have something listening on, say, `http://localhost:8000/v1` that accepts requests like:

```json
{
  "model": "nemotron-3-super",
  "messages": [
    { "role": "system", "content": "You are..." },
    { "role": "user", "content": "Hello" }
  ]
}
```

and replies in OpenAI chat format.

### 2. Add a Custom Provider in `openclaw.json`

Once you have an endpoint, configure OpenClaw:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "dgx-llm": {
        "baseUrl": "http://127.0.0.1:8000/v1",
        "apiKey": "dgx-local",          
        "api": "openai-completions",    
        "models": [
          {
            "id": "nemotron-3-super",
            "name": "Nemotron 3 Super",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 1000000,
            "maxTokens": 32768
          },
          {
            "id": "openai/gpt-oss-20b",
            "name": "GPT-OSS 20B",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 128000,
            "maxTokens": 4096
          }
        ]
      }
    }
  }
}
```

This mirrors the official custom provider examples and is fully compatible with OpenClaw’s model system.[^2][^6]

### 3. Allowlist Models for Agents

To avoid  "model not allowed" errors, add allowlist entries:[^6]

```json
{
  "agents": {
    "defaults": {
      "models": {
        "dgx-llm/nemotron-3-super": {
          "alias": "nemotron-super"
        },
        "dgx-llm/openai/gpt-oss-20b": {
          "alias": "gpt-oss-20b-fast"
        }
      }
    }
  }
}
```

You can also set per‑agent overrides:

```json
{
  "agents": {
    "list": [
      {
        "id": "coordinator",
        "models": {
          "primary": "dgx-llm/nemotron-3-super"
        }
      },
      {
        "id": "coder",
        "models": {
          "primary": "dgx-llm/openai/gpt-oss-20b"
        }
      }
    ]
  }
}
```

### 4. Restart the Gateway and Verify

After editing `~/.openclaw/openclaw.json`:

```bash
systemctl --user restart openclaw-gateway
sleep 3
openclaw models list   # or the UI /models view
```

You should see `nemotron-super` and `gpt-oss-20b-fast` as available model aliases, and agents using them will route through your vLLM/TRT‑LLM server.

***

## Compatibility and Pitfalls

### API Compatibility

The OpenClaw custom provider docs stress that **the only requirement is API compatibility**, not engine type:[^2]

- Use `"api": "openai-completions"` for OpenAI‑style `/v1/chat/completions` APIs.
- Use `"api": "anthropic-messages"` for Anthropic‑style APIs, if your gateway exposes that.
- If the backend is neither, place a translation layer (LiteLLM, OpenRouter, etc.) in between.

As long as your vLLM/TRT‑LLM server behaves like OpenAI’s chat API, OpenClaw will treat it like any other provider.

### Model IDs and Names

Ensure that:

- `models[].id` matches exactly what the backend expects in the `model` field.
- The fully‑qualified OpenClaw identifier is `providerName/modelId`, and that same string appears in the allowlist.[^6]

Incorrect IDs are a common source of 404 or "model not allowed" errors.

### Performance vs. Ollama

On DGX Spark, SGLang and TensorRT‑LLM demos show GPT‑OSS 20B at ~70 tokens/s and GPT‑OSS 120B at ~50 tokens/s when configured properly. This is often **significantly faster** than naïve large‑model serving via Ollama on the same hardware.[^7][^9]

By routing OpenClaw through such an engine you can:

- Keep your OpenClaw agent workflows unchanged.
- Gain faster token throughput and better GPU utilisation.
- Still fall back to Ollama for quick local experimentation or smaller models.

***

## Practical Recommendation for DGX Spark

Given current docs and ecosystem patterns, the most robust, low‑friction setup for you is:

1. **Keep Ollama** for quick local testing and smaller models.
2. **Set up a high‑performance vLLM or TensorRT‑LLM stack** (possibly via SGLang or TGI) for your heavy models (Nemotron 3 Super, GPT‑OSS‑20B/120B). 
3. **Expose that stack via an OpenAI‑compatible HTTP API**, directly or via LiteLLM.
4. **Register it as a custom provider** (`dgx-llm`) in `openclaw.json` with allowlisted models.
5. **Point your coordinator and performance‑sensitive workers** at `dgx-llm/nemotron-3-super` or `dgx-llm/openai/gpt-oss-20b` while leaving everything else in OpenClaw unchanged.

This approach uses mechanisms that OpenClaw already documents and supports (custom providers + model allowlists) and lines up directly with NVIDIA and ecosystem guidance for DGX Spark, minimising compatibility risk while gaining the performance benefits of DGX‑optimised engines.[^7][^3][^2]

---

## References

1. [OpenClaw Model Selection & API Providers | MI - 超智諮詢](https://www.meta-intelligence.tech/en/insight-openclaw-model-guide) - OpenClaw natively supports six API Providers (Anthropic, OpenAI, Google, DeepSeek, Ollama, OpenRoute...

2. [How to Add Custom Models to OpenClaw - LaoZhang AI Blog](https://blog.laozhang.ai/en/posts/openclaw-custom-model) - Learn how to add any LLM provider to OpenClaw using models.providers configuration. This guide cover...

3. [Run OpenClaw For Free On NVIDIA RTX GPUs & DGX Spark](https://www.nvidia.com/en-gb/geforce/news/open-claw-rtx-gpu-dgx-spark-guide/) - In this guide, we'll show you how you can run OpenClaw and the LLMs completely locally on NVIDIA RTX...

4. [The simplest and fastest way to setup OpenClaw](https://ollama.com/blog/openclaw-tutorial) - Setup OpenClaw in under two minutes with a single Ollama command ... OpenClaw is a personal AI assis...

5. [Run OpenClaw locally for free with Ollama and zero API cost](https://lumadock.com/tutorials/openclaw-ollama-local-models-setup?language=italian) - How do I connect OpenClaw to Ollama? The simplest route is ollama launch openclaw which Ollama docum...

6. [OpenClaw Custom Provider: Add Any LLM API in 5 Minutes](https://haimaker.ai/blog/integrating-custom-llm-providers-with-clawdbot/) - OpenClaw Custom Provider: Add Any LLM API in 5 Minutes · Step 1: Find your OpenClaw config · Step 2:...

7. [Optimizing GPT-OSS on NVIDIA DGX Spark: Getting the Most Out of ...](https://lmsys.org/blog/2025-11-03-gpt-oss-on-nvidia-dgx-spark/) - The results are impressive: around 70 tokens/s on GPT-OSS 20B and 50 tokens/s on GPT-OSS 120B, which...

8. [OpenClaw | DGX Spark - NVIDIA NIM APIs](https://build.nvidia.com/spark/openclaw/instructions) - If you prefer snappier replies, use gpt-oss-20b (or a 30B model) instead; both run comfortably on DG...

9. [How to Run OpenAI's GPT OSS 120b on NVIDIA DGX Spark](https://www.ridgerun.ai/post/how-to-run-openai-s-gpt-oss-120b-on-nvidia-dgx-spark) - Learn to run the OpenAI's open source GPT OSS 120b on the NVIDIA DGX Spark computer with our step-by...

10. [Introducing multi-backends (TRT-LLM, vLLM) support for ...](https://huggingface.co/blog/tgi-multi-backend) - We are excited to introduce the concept of TGI Backends. This new architecture gives the flexibility...

11. [vLLM vs Triton vs TGI: Choosing the Right LLM Serving ...](https://www.clarifai.com/blog/model-serving-framework/) - A deep comparison of Triton, vLLM, and TGI for model serving. Explore batching, KV caching, hardware...

12. [Supported Models - vLLM](https://docs.vllm.ai/en/latest/models/supported_models.html) - Some models are supported only via the Transformers modeling backend. The purpose of the table below...

