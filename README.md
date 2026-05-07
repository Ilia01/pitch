# Pitch

A CLI for sending small-batch, personalized cold emails — built because generic outreach tools produce spam, and manual outreach takes too long to do consistently.

## Status

v0.1 in development. Phase 1 of 6 complete: skeleton, config, SQLite migrations, init command.

## Why

Cold email at small scale only works when each message is researched and personalized. Mass-blast tools optimize for volume and produce output recipients ignore. Pitch optimizes for the opposite: 10 carefully-personalized emails per day, with the mechanical middle automated and the human judgment kept in the loop.

## How it works

```
pitch init                       Scaffold a campaign workspace
pitch leads add leads.csv        Import leads from CSV
pitch template add intro.md      Register a template
pitch generate jobs              Generate personalized openers via LLM
pitch preview jobs               Review drafts before sending
pitch edit <draft-id>            Tweak a draft in $EDITOR
pitch send jobs                  Dry-run by default
pitch send jobs --confirm        Actually send via Resend
pitch status                     Counts and progress
```

LLM provider chain: Anthropic Claude → Groq → Ollama (configurable). Falls back automatically on transport errors; hard-fails on safety refusals.

## Requirements

- Node 24 LTS (Krypton) — uses built-in `node:sqlite`, no native bindings
- pnpm 10+
- An Anthropic, Groq, or Ollama setup (at least one)
- A Resend account (sandbox is fine for development)

## Quickstart (development)

```bash
pnpm install
cp .env.example .env             # fill in API keys
pnpm dev -- init                 # scaffold a workspace in CWD
pnpm test                        # run vitest suite
pnpm typecheck
pnpm lint
```

## Testing model

Two layers, both required:

| Layer | What it covers | How |
|---|---|---|
| **Vitest** (unit + integration) | Pure logic, parsing, validation, state transitions, provider chain orchestration with mocked providers, Resend mocked. | `pnpm test` |
| **Sandbox end-to-end** | Real Anthropic/Groq/Ollama calls, real Resend calls in sandbox mode (delivers only to your verified test address). Catches real-API behavior the mocks can't. | Run CLI with `RESEND_PROD=false` and `RESEND_TEST_EMAIL=you@yourdomain.com`. |

The sandbox layer is the only safe way to test the full pipeline against real APIs. Production mode is gated behind `RESEND_PROD=true` plus a verified domain — see Phase 6 in the roadmap.

## Roadmap

- **v0.1** — single-user CLI: leads, templates, drafts via LLM, send via Resend (sandbox), status.
- **v0.2** — open tracking pixel, follow-up sequences, Apollo enrichment.
- **v0.3** — reply detection, A/B template support, per-template stats.

## License

Apache-2.0. See [LICENSE](./LICENSE).
