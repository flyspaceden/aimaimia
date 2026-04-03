# AI Voice Operation Lane Design

Date: 2026-04-03

## Summary

This design narrows the current AI voice scope to an `operation-first` lane optimized for speed and correctness. The first stage covers only five task families:

- page navigation
- product search
- company search/list
- add to cart
- order lookup

The core product rule is:

`default to list/results; only go to detail or execute an action when a single target is matched with high confidence.`

This design explicitly does not treat the current voice entry as a general-purpose conversational AI entrypoint.

## Why This Change

The current chain is directionally correct because it already has:

- structured `intent / slots / resolved`
- controlled execution
- category/company candidate constraints
- session persistence and timing logs

But the current runtime behavior is still too expensive and too broad for high-frequency voice operations:

- simple requests can fall into slow model paths
- one service owns routing, normalization, entity resolution, execution, chat, and recommendation
- the system is still incentivized to over-infer detail targets from natural language
- there is no hard online budget for the operation lane

The result is a mismatch between product goals and chain behavior:

- users expect natural language control over the app
- the app needs deterministic, fast, low-risk execution
- the current chain still behaves too much like a unified understanding pipeline

## Product Goals

Stage 1 goals:

- correctness over aggressiveness
- high-frequency operation requests should feel fast
- low-confidence requests must not misfire
- search-like requests should default to result lists
- action execution should require stronger evidence than understanding

Stage 1 success criteria:

- page navigation, order lookup, obvious product search, and obvious company list requests should target `<= 2s` for common cases
- the operation lane should use `0 or 1` lightweight model calls
- operation requests should not route into heavy conversational chains
- default behavior should be predictable enough to explain as product rules

## Non-Goals

The following are explicitly out of scope for this stage:

- RAG
- TTS
- on-device ASR
- chat-page voice input
- complex recommendation expansion
- full Phase C rollout
- full Phase D geolocation rollout
- AI analytics dashboard

These can remain roadmap items, but they should not shape the first-stage operation lane.

## First-Stage Product Rules

### Global Rule

`Default to list/results.`

Escalation path:

1. execute directly only when intent and target are explicit enough
2. otherwise go to results/list
3. only fall back to feedback when even a safe list/result target cannot be formed

### Page Navigation

Direct execution is allowed when:

- target page is explicit
- target is on a route whitelist
- no additional business context is required

Examples:

- `打开购物车` -> cart
- `去首页` -> home
- `查看订单` -> orders

### Product Search

Default behavior:

- route to product results

Detail is allowed only when:

- phrasing is strongly singular/detail-oriented
- a single product is matched
- confidence exceeds a detail threshold

Examples:

- `找苹果` -> results list
- `看看低糖水果` -> results list
- `打开云南蓝莓礼盒` -> product detail only if unique and high-confidence

### Company Search / Company List

Default behavior:

- route to company list/results

Detail is allowed only when:

- the request explicitly asks to open or view a specific company
- a single company is matched
- confidence is high

Examples:

- `找武汉的企业` -> company list with `location=武汉`
- `看看农场` -> company list
- `打开青禾农场` -> detail only if unique and high-confidence

### Add To Cart

Direct execution is allowed only when:

- the user clearly requested add-to-cart
- a single product is matched
- the product is purchasable
- quantity is explicit or safely defaults to 1

Otherwise:

- route to product results or product detail for confirmation

### Order Lookup

Default behavior:

- route to order list, optionally filtered by status

Direct order-detail navigation is allowed only when:

- a single order is clearly identified
- or current context narrows to one order with high confidence

## Target Architecture

The operation lane should use a fixed four-step structure:

`router -> normalizer -> resolver -> execution policy`

### 1. Fast Route

Purpose:

- catch explicit page navigation
- catch order lookup intents
- catch obvious product search
- catch obvious company list/search

Requirements:

- no model call
- optimized for common, short, explicit requests

### 2. Structured Normalize

Purpose:

- call one lightweight model only when rules are insufficient
- normalize natural language into structured output

Output:

- `intent`
- `slots`
- `confidence`
- `fallbackReason`

This layer does not choose final app actions.

### 3. Entity Resolve

Purpose:

- map normalized slots to real app entities and filters
- determine list vs detail eligibility

Examples:

- `鲜果` -> category `水果`
- `武汉的公司` -> company list filter `location=武汉`
- `青禾农场` -> unique company candidate
- `鸡蛋` -> search result list, not product detail by default

### 4. Controlled Execution

Purpose:

- translate structured results into explicit app actions
- apply product rules and confidence thresholds

This layer owns decisions such as:

- list vs detail
- direct add-to-cart vs search fallback
- order list vs single-order detail

## Module Boundaries

The current `AiService` is too broad. Stage 1 should preserve the Nest module boundary but split responsibilities internally.

Recommended modules/services:

### VoiceEntryService

Responsibilities:

- receive transcript from ASR stage
- orchestrate the lane
- collect timing
- persist logs and session records

### OperationRouter

Responsibilities:

- fast-rule routing
- decide whether normalization is needed
- reject non-operation requests from the operation lane

### IntentNormalizer

Responsibilities:

- one lightweight model call when needed
- convert language into `intent / slots / confidence`

This service must not decide final app navigation or direct actions.

### EntityResolver

Responsibilities:

- product resolver
- company resolver
- order resolver
- navigation resolver

Primary question:

- can this request be safely handled as a list/result?
- if not, is there enough evidence for a single-target detail/action?

### ExecutionPolicy

Responsibilities:

- final action mapping
- thresholds
- downgrade rules
- auth and business safeguards

## Online Model Budget

The operation lane should have a hard online budget:

- fast route: `0` model calls
- semantic normalization: `1` lightweight call max
- no `plus` model in the operation lane

This is a product decision, not just a performance optimization. Without it, the `<= 2s` goal is not controllable.

## Performance Strategy

### Latency Objectives

- P50 high-frequency operation requests: `<= 2s`
- P95 high-frequency operation requests: `<= 3.5s`
- more complex operation requests: `<= 5s`

These goals apply to:

- page navigation
- order list lookup
- obvious product search
- obvious company list requests

They do not apply to open-ended chat or rich recommendation reasoning.

### Practical Performance Rules

- rule-first for high-frequency operation requests
- one normalization step max
- execution decisions stay local
- list-first is the default safe and fast path

## Measurement and Evaluation

The operation lane needs explicit metrics. At minimum:

- `fast_route_hit_rate`
- `model_route_rate`
- `list_fallback_rate`
- `detail_direct_rate`
- `auto_add_to_cart_rate`
- `misfire_rate`
- `p50_total_ms`
- `p95_total_ms`

Also add richer chain timing:

- `router_ms`
- `normalize_ms`
- `resolve_ms`
- `execution_ms`
- `model_used`
- `fast_route_hit`

The system also needs a replayable evaluation set built from real `AiUtterance` data with manually labeled expected outcomes.

## Implementation Sequence

### Phase 1: Chain Contraction

- formally redefine the current voice entry as an operation-first entry
- exclude chat-heavy and recommendation-heavy behavior from the primary operation path
- codify list-first execution rules

### Phase 2: High-Frequency Fast Route

- expand rule hits for page navigation
- expand rule hits for order lookup
- expand rule hits for company list/search
- expand rule hits for obvious product search

### Phase 3: Observability

- complete timing instrumentation
- log route mode and fallback path
- create evaluation samples from real traffic

### Phase 4: Controlled Semantic Expansion

- improve product normalization
- improve company normalization
- improve detail eligibility logic
- improve direct add-to-cart precision

## Changes Recommended For ai.md

`ai.md` should be updated, not just appended to.

Recommended changes:

### 1. Add a new top-level section for the first-stage operation lane

This section should define:

- the five in-scope task families
- the global rule: default to list/results
- detail/action eligibility rules
- the online model budget

### 2. Reframe the current voice entry

Make it explicit that the current voice entry is:

- not a general-purpose chat lane
- an operation-first lane with controlled execution

### 3. Add a section for architecture boundaries

Document:

- `router -> normalizer -> resolver -> execution policy`
- frontend as executor of structured actions, not natural-language interpreter

### 4. Add a first-stage performance budget section

Document:

- `0 or 1` light model calls for the operation lane
- no `plus` model in the operation main path
- `<= 2s` target for high-frequency operation requests

### 5. Move later roadmap items into a clearer “candidate enhancements” section

Phase C, Phase D, RAG, TTS, on-device ASR, and analytics should remain documented, but they should be visibly marked as:

- not part of the first-stage operation-lane convergence
- gated by the first-stage stability work

## Risks

### Risk 1: Rule scope grows uncontrollably

Mitigation:

- rules should only target high-frequency, explicit, operation-like utterances
- semantic normalization remains available as a second line

### Risk 2: Over-conservative behavior frustrates users

Mitigation:

- the primary fallback is list/results, not failure
- only a narrow set of requests should drop to feedback-only

### Risk 3: The lane stays hard to evaluate

Mitigation:

- create and maintain a replay set from real usage
- score final action correctness, not just model confidence

## Recommended First Deliverable

The first-stage deliverable should be framed as:

`AI Voice Operation Lane Convergence v1`

Done means:

- only five core task families are in scope
- list-first rules are enforced
- operation lane uses `0 or 1` lightweight model calls
- high-frequency requests are measurably faster
- timing and fallback behavior are observable
- roadmap expansion is intentionally deferred
