# Portfolio Workflow Futures Decoupling Plan

## Overview
The current "portfolio workflow" automation treats spot and futures trades as variations of the same review loop. The goal of this document is to outline how the workflow operates today, highlight the coupling problems, and specify concrete engineering tasks to fully separate spot and futures trading experiences.

## Current Implementation
- **Single review loop** – `reviewPortfolios` loads active workflows, builds a prompt with `collectPromptData`, sends it to `main-trader`, and executes the returned orders in `createDecisionLimitOrders`.【F:backend/src/workflows/portfolio-review.ts†L1-L337】【F:backend/src/services/rebalance.ts†L1-L188】
- **Shared prompt** – `collectPromptData` queries Binance spot account balances, token prices, and builds one `RebalancePrompt` object. All market datasets (routes, policy floors, news, etc.) are spot-centric.【F:backend/src/agents/main-trader.ts†L406-L721】
- **Shared response schema** – `MainTraderDecision` accepts an array of limit orders where each order may optionally include a `futures` block. Spot and futures intents therefore share validation, limit-order assumptions, and execution paths.【F:backend/src/agents/main-trader.types.ts†L90-L148】
- **Unified executor** – `createDecisionLimitOrders` records every decision in `limit_order` and first tries to run `executeFuturesOrder` when the `futures` block is present, otherwise it falls back to Binance spot order placement. Futures actions are forced through the same min-notional and price-drift logic designed for spot limit orders.【F:backend/src/services/rebalance.ts†L189-L398】

## Pain Points
1. **Prompt mismatch** – The prompt never includes futures wallet balances, open positions, funding data, leverage constraints, or risk metrics, so the agent does not have the context required for futures risk management.【F:backend/src/agents/main-trader.ts†L406-L721】
2. **Schema overload** – The decision schema mixes spot limit-order requirements (base price, drift checks, min notional) with optional futures intents. The executor runs futures trades before any spot validations, but still records them inside the `limit_order` table as if they were spot limit orders.【F:backend/src/services/rebalance.ts†L189-L398】
3. **Execution rules conflict** – Futures trades require very different controls (position sizing, margin checks, stop/TP orchestration) that cannot reuse spot order validation logic. The current branch skips large portions of futures-specific checks or logs confusing cancellation reasons.【F:backend/src/services/rebalance.ts†L189-L398】
4. **Exchange abstraction leak** – `getExchangeGateway` exposes futures capabilities per exchange, but the workflow cannot choose different prompts or instructions per execution mode. All workflows are implicitly spot-first even when only futures APIs are needed.【F:backend/src/services/exchange-gateway.ts†L1-L173】

## Target Experience
- Operators configure a workflow as **Spot** or **Futures** (potential third type later for cross-margin strategies).
- Modes are mutually exclusive in this phase to keep data, prompts, and execution pipelines isolated.
- Each mode has independent prompt generation, AI instructions, and schema validation tailored to its data and controls.
- Execution pipelines match the order type: spot mode submits exchange limit orders; futures mode opens/updates positions with leverage, stop loss, and take profit instructions.
- Review logs, audit trails, and UI clearly state which engine produced the decision.

## Proposed Architecture
1. **Workflow Mode Flag**
   - Add a `mode` column to `portfolio_workflow` with enum values `spot` | `futures` (default `spot`). Gate workflow selection, prompt builders, and execution paths on this flag.
   - Surface the mode in API payloads, validation, and frontend forms.
   - Keep the existing scheduling cadence shared across both modes; no additional cron or risk-threshold tracks are necessary initially.

2. **Dedicated Agents**
   - Split `main-trader` into `spot-trader` and `futures-trader` modules. Each module owns its developer instructions, response schema, and JSON validation.
   - Keep shared utilities (news analysis, sentiment) in reusable helpers.

3. **Prompt Builders**
   - Extract the current `collectPromptData` logic into `buildSpotPrompt`. Trim futures-related placeholders from the resulting schema.
   - Create a new `buildFuturesPrompt` that pulls: futures wallet balances (`exchangeGateway.futures.fetchWallet`), open positions, funding rates, mark prices, leverage limits, and any risk settings specific to the workflow.
   - Cache or batch external calls separately for spot vs futures workloads to avoid mixing assumptions.

4. **Execution Pipelines**
   - Introduce `executeSpotDecision` (refined from `createDecisionLimitOrders`) that only handles spot limit orders and removes the futures branch.
   - Create `executeFuturesDecision` that:
     - Validates futures intents (position side, leverage bounds, order type) against exchange constraints.
     - Orchestrates leverage, entry, stop, and take profit updates using `exchangeGateway.futures` helpers.
     - Records results in a futures-specific repository/table (either extend `limit_order` with a discriminator or create `futures_order`).

5. **Review Loop Orchestration**
   - Update `executeWorkflow` so it dispatches to the correct prompt builder, agent runner, and executor based on `mode`.
   - Ensure failure handling and retry policies remain consistent but log the mode in each entry for observability.

6. **Observability & Audit**
   - Expand review logs to include the workflow mode and agent identifier.
   - Ensure prompts/responses are stored separately or tagged to simplify downstream analytics.

## Task Breakdown
1. **Schema & Repository updates**
   - Create migration adding `portfolio_workflow.mode` (enum text) and optional futures config fields (e.g., default leverage, margin mode).
   - Update `portfolio-workflows` repository and tests to read/write the new mode.

2. **API & Frontend wiring**
   - Extend workflow create/update APIs to validate the new mode.
   - Update frontend forms to let users choose Spot vs Futures with contextual help and render mode-specific history tables (spot limit orders vs. futures trades).

3. **Agent refactor**
   - Extract existing spot-specific prompt/logic into `agents/spot-trader`.
   - Build `agents/futures-trader` with new prompt schema and tailored instructions.
   - Adjust AI invocation paths to select the right agent based on workflow mode.

4. **Prompt data services**
   - Implement spot prompt builder wrapper.
   - Implement futures prompt builder leveraging exchange gateways for wallet balances, open positions, funding, and mark prices.
   - Add caching/ batching strategies for the new data sources.

5. **Execution services**
   - Replace `createDecisionLimitOrders` with `executeSpotDecision` (spot only).
   - Build `executeFuturesDecision` with dedicated persistence (new repo or extended schema) and integration tests against mock gateways.

6. **Workflow runner orchestration**
   - Update `executeWorkflow` to branch by mode, call the proper agent, and record review results with the new metadata.
   - Ensure retries and cancellation logic operate per mode without cross-contamination.

7. **Testing & Validation**
   - Update unit/integration tests to cover both modes end-to-end.
   - Add fixtures for futures prompts/responses, verifying schema validation and execution side effects.

8. **Documentation & Migration Plan**
   - Document the operational changes for the support team (workflow migration steps, limitations).
   - Provide a data migration script or manual steps to set existing workflows to `spot` mode and flag futures workflows for recreation.

## Open Questions & Resolutions
- **Do futures workflows require separate scheduling cadences or risk thresholds?** No. Futures reviews can reuse the existing scheduling cadence and risk-threshold configuration, so no additional scheduler track is required in the first phase.
- **Should we support hybrid workflows in the future, or will mode be mutually exclusive?** Mode remains mutually exclusive for now. Engineering should optimize for a clean split between spot and futures paths, leaving hybrid scenarios for a later iteration.
- **How should we display futures trade history alongside spot limit orders in the UI?** Render mode-specific history views. When a workflow is marked as futures, the frontend should surface a dedicated futures trade table instead of the spot limit-order table, with copy explaining the distinction.
