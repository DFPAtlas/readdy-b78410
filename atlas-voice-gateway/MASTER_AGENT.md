# Master Voice Agent — V1

## Role

The Master Voice Agent is the orchestration layer above HAL and TRON.

It owns the question **"what should happen next?"** while HAL and TRON remain
specialists that perform the actual reasoning/work.  The browser still talks
only to Atlas Voice Gateway.

```
Martin
  ↓ voice/text
Atlas Voice Console
  ↓
Atlas Voice Gateway
  ↓
Master Voice Agent
  ├─ HAL  — infrastructure / operations
  └─ TRON — engineering / RAG
```

## V1 rules

1. Explicit console HAL/TRON selection remains authoritative.
2. In AUTO, a spoken direct address such as "HAL..." or "TRON..." wins.
3. Clear infrastructure intent selects HAL.
4. Clear engineering/repository/RAG intent selects TRON.
5. Ambiguous follow-up turns stay with the current agent for conversational
   continuity instead of alternating between agents.
6. If the intended specialist is unavailable, the decision records an explicit
   failover rather than pretending the intent changed.
7. The master decision is structured and auditable: selected agent, intent,
   reason, confidence, requested agents, and continuation state.

## Safety boundary

V1 only chooses an execution target. It cannot directly run shell commands,
change infrastructure, write databases, send email, spend money, or approve
high-impact actions.

Those capabilities belong in later tool adapters with per-tool permissions and
confirmation policy.

## Next implementation slices

- Wire MasterVoiceAgent into AUTO routing in `app/main.py`.
- Add master-decision fields to WebSocket routing events/diagnostics.
- Add persistent session memory interface (Supabase-backed later; no secrets in
  the frontend).
- Add a tool registry for n8n and controlled operational actions.
- Add approval levels: read-only, reversible write, privileged/destructive.
- Add multi-agent plans so one request can ask HAL for live infrastructure
  state and TRON for code/RAG evidence, then merge the results.
- Add master-agent system prompt/persona only after deterministic policy and
  permissions are covered by tests.
