# DAVIL Cod

[![CI](https://github.com/Artur21101965/davil-cod/actions/workflows/ci.yml/badge.svg)](https://github.com/Artur21101965/davil-cod/actions)
[![Docker Hub](https://img.shields.io/docker/pulls/nik951751/davil-cod.svg)](https://hub.docker.com/r/nik951751/davil-cod)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/davil-cod.svg)](https://www.npmjs.com/package/davil-cod)
[![GitHub stars](https://img.shields.io/github/stars/Artur21101965/davil-cod?style=social)](https://github.com/Artur21101965/davil-cod)

**[Русская версия](README.ru.md) · Russian version**

## Why pay for LLMs when free ones exist?

Your AI agent, bot, or script talks to a single OpenAI-compatible endpoint.
Behind it, DAVIL Cod automatically routes requests across **18 free models**
from Groq, Mistral, Gemini, NVIDIA NIM, OpenRouter, and ZAI. If one provider
goes down, gets overloaded, or burns its daily limit — the request
**instantly falls through to the next one**. You never see "rate limit",
and you never pay.

**Result:** full LLM access for everyday work at the price of **$0**.

![DAVIL Cod Dashboard](assets/dashboard.png)

## Features

| | |
|---|---|
| 🔀 **Auto-failover** | 18 providers in one chain. Provider down? The next one answers. |
| 💰 **Free** | Free models only. The dashboard shows each provider's remaining limit. |
| ⚡ **Smart routing** | Picks the fastest, most stable provider for every request. |
| 🛡️ **Reliability** | Circuit breaker, request queue, auto-disable of dead providers, watchdog. |
| 📊 **Dashboard** | Status, speed, limits, history, tokens, RPM chart. |
| 💾 **Disk cache** | Repeat prompts don't consume limits at all. |
| 🔌 **Compatible** | Any OpenAI client: opencode, Cursor, your scripts. |

## Quick start — 30 seconds

```bash
npx davil-cod init -i     # wizard: password + each provider's key
npx davil-cod start       # proxy on http://localhost:4000
npx davil-cod test        # verify everything works
```

Dashboard: `http://localhost:4000/?key=your_password`

Or via Docker:

```bash
docker run -d --name davil-cod -p 4000:4000 \
  -e PROVIDER_GROQ_APIKEY=... \
  -e PROVIDER_MISTRAL_APIKEY=... \
  -e AUTH=your-secret-key \
  nik951751/davil-cod
```

### Connect any OpenAI client

| Field | Value |
|-------|-------|
| Base URL | `http://localhost:4000/v1` |
| API Key | your password from `init` |
| Model | `tier-s` (fast) / `tier-splus` (powerful) |

Example for opencode (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "provider": {
    "free-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DAVIL Cod",
      "options": {
        "baseURL": "http://localhost:4000/v1",
        "apiKey": "your-secret-key-here"
      },
      "models": {
        "tier-splus": { "name": "DAVIL Cod (Best)", "input": ["text"] },
        "tier-s": { "name": "DAVIL Cod (Fast)", "input": ["text"] }
      }
    }
  }
}
```

## Supported providers

| Provider | Models | Where to get key | Limit/day |
|----------|--------|------------------|-----------|
| Groq | gpt-oss-120b, qwen-27b | console.groq.com | 1000 |
| Mistral | codestral, small | console.mistral.ai | 500K tok |
| NVIDIA NIM | deepseek, llama, vision | build.nvidia.com | 40 |
| Gemini | gemini-3.6-flash, vision | aistudio.google.com | 1500 |
| OpenRouter | cohere-north, glm, nemotron, ox-alpha | openrouter.ai | 50-100 |
| ZAI | glm-4.7-flash | open.bigmodel.cn | 1000 |

> The catalog is extensible: add a model to `providers.json` and it joins the pool.
> Providers unavailable to your key (404) are auto-disabled.

## How it works

1. A request arrives at `/v1/chat/completions` (OpenAI format).
2. DAVIL Cod picks the best provider: healthy, under limit, fastest today.
3. If it fails — instantly tries the next one in the chain.
4. The response returns in the same format — the client never notices.

## Development

```bash
npm test          # unit tests (17)
node server.js    # run from source
```

## Configuration

**Keys** — only in `.env` (never committed):

```bash
PROVIDER_GROQ_APIKEY=...       # Groq
PROVIDER_MISTRAL_APIKEY=...    # Mistral
PROVIDER_GEMINI_APIKEY=...     # Gemini
PROVIDER_NIM_APIKEY=...        # NVIDIA NIM
PROVIDER_OPENROUTER_APIKEY=... # OpenRouter
PROVIDER_ZAI_APIKEY=...        # ZAI
```

**Server settings** — in `config.json` or env:

| Setting | Env | Default |
|---------|-----|---------|
| Port | `PORT` | `4000` |
| Password | `AUTH` | empty (no auth) |
| Rate limit/min | `config.json → rateLimit` | 100/min |

**Providers** — catalog in `providers.json` (18 models). Add your own:
put it in `config.json` → `providers` (same format as `providers.json`).

## CLI commands

```bash
npx davil-cod init              # create config
npx davil-cod init -i           # interactive wizard (keys, password)
npx davil-cod start             # start proxy
npx davil-cod status            # diagnostics: providers, limits, errors
npx davil-cod test              # verify it works
npx davil-cod install-service   # autostart at boot
npx davil-cod dashboard         # open dashboard
```

## FAQ

**Is this legal?** Yes. You connect **your own** free provider keys — you just
get a single reliable gateway to all of them.

**How much does it cost?** $0. Only the free-tier limits of the providers.

**Which models are fastest?** The proxy measures and picks. Currently leading:
Qwen (Groq, ~300ms) and cohere-north (OpenRouter).

**Can I add my own provider?** Yes — add it to `config.json` or `providers.json`.

**Is it only for opencode?** No. Any OpenAI-compatible client
(see `examples/` — Cursor, Claude Code, scripts).

## Tools

### Shorts generator — `tools/generate_shorts.py`
Free vertical video (9:16) generation via **MiniMax H3** (video + sound from
one prompt) or **Wan 2.1**. Runs through Hugging Face online demos — GPU in
the cloud, no install.

```bash
cd tools
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
export HF_TOKEN=hf_xxx            # free: huggingface.co → settings/tokens
./.venv/bin/python generate_shorts.py "Cozy morning scene, warm light" --format 9:16 --duration 5
```

Prompt catalog: `tools/prompts.md`.

## License

MIT
