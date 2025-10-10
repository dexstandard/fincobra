# Exchange Integration Task Plan

## Current Snapshot
- Binance spot logic is tightly coupled to trading orchestration and decision flows, with `order-orchestrator` and `rebalance` directly invoking Binance helpers for order lifecycle management.【F:backend/src/services/order-orchestrator.ts†L1-L200】【F:backend/src/services/rebalance.ts†L1-L200】
- The REST layer exposes Binance-only account and balance endpoints, while Bybit currently only surfaces a futures wallet balance handler without order controls.【F:backend/src/routes/binance-balance.ts†L1-L108】【F:backend/src/routes/bybit-futures-balance.ts†L1-L32】
- Binance futures helpers exist in a separate module and Bybit futures helpers already cover leverage, order placement, and stop configuration, but neither is abstracted behind a common interface.【F:backend/src/services/binance-futures.ts†L1-L112】【F:backend/src/services/bybit-client.ts†L1-L200】【F:backend/src/services/bybit-client.ts†L320-L408】
- Frontend prerequisite, workflow setup, and balance components still assume Binance-first behaviors, only partially branching for Bybit and lacking UI for futures-specific actions.【F:frontend/src/lib/usePrerequisites.ts†L1-L206】【F:frontend/src/routes/PortfolioWorkflowSetup.tsx†L1-L258】【F:frontend/src/components/forms/ExchangeApiKeySection.tsx†L1-L48】

## Sequential Task Breakdown
1. **Consolidate exchange requirements** ✅
   - Added `backend/src/services/exchange-gateway.types.ts` to codify the normalized spot and futures operations the AI layer depends on without leaking exchange-specific structures.
   - Introduced mapper utilities in `backend/src/services/exchange-gateway.mappers.ts` so existing Binance and Bybit helpers can be translated into the shared contract while keeping conversions isolated.
   - Covered the new mappers and type alignment with `backend/test/services/exchange-gateway.mappers.test.ts`, exercising numeric coercion, defensive parsing, and verifying the helper composition satisfies the specification.
   - Bybit market metadata lookups still need implementation when the gateway adapters are introduced; the futures wallet and trade controls are now described by the shared contract.【F:backend/src/services/exchange-gateway.types.ts†L1-L120】【F:backend/src/services/exchange-gateway.mappers.ts†L1-L120】【F:backend/test/services/exchange-gateway.mappers.test.ts†L1-L200】

2. **Introduce backend exchange abstraction** ✅
   - Added `backend/src/services/exchange-gateway.ts` which exposes `getExchangeGateway` and adapter instances for Binance and Bybit. The Binance adapter wires metadata, spot, and futures calls through the existing helpers while normalizing payloads via the mapper utilities; the Bybit adapter focuses on futures-only controls and surfaces metadata as not yet implemented.【F:backend/src/services/exchange-gateway.ts†L1-L164】
   - Created `backend/test/services/exchange-gateway.test.ts` to cover the adapter behavior, asserting delegation to helper functions, defensive order-id parsing, payload normalization, and Bybit futures wiring using Vitest mocks.【F:backend/test/services/exchange-gateway.test.ts†L1-L241】

3. **Refactor orchestration and workflows to use the abstraction** ✅
   Updated `order-orchestrator`, `rebalance`, and workflow validation logic to depend on the exchange gateway. Planned orders now carry the exchange identifier so reconciliation and cancellation route through the matching adapter, including handling exchange responses that immediately report a filled cancel. Workflow validation selects markets via the gateway when metadata is available and skips the lookup for Bybit to allow futures-only workflows to activate. Unit tests cover the gateway-backed orchestration and rebalance behaviour, including Bybit workflow routes and exchange-driven open-order reconciliation.【F:backend/src/services/order-orchestrator.ts†L1-L220】【F:backend/src/services/rebalance.ts†L1-L380】【F:backend/src/services/portfolio-workflows.ts†L1-L320】【F:backend/test/portfolio-workflows-routes.test.ts†L1-L200】【F:backend/test/portfolio-workflow-exec-log.test.ts†L1-L220】【F:backend/test/open-orders-cleanup.test.ts†L1-L220】【F:backend/test/sync-open-order-statuses.test.ts†L1-L120】

4. **Expand HTTP surface for futures trading**  
   Add REST endpoints for futures leverage, position opens/closes, and stop controls for both Binance and Bybit, powered by the new abstraction. Reuse rate limit presets and error handling utilities so responses remain consistent across exchanges.【F:backend/src/routes/binance-balance.ts†L1-L108】【F:backend/src/routes/bybit-futures-balance.ts†L1-L32】【F:backend/src/services/bybit-client.ts†L320-L408】

5. **Wire AI decision outputs to exchange futures operations**  
   Extend the review/rebalance pipeline so futures-directed orders map onto the abstraction, including translating agent instructions into futures parameters (position side, leverage, stop-loss / take-profit). Guarantee backward compatibility for existing spot workflows during the transition.【F:backend/src/services/rebalance.ts†L1-L200】【F:backend/src/services/binance-futures.ts†L1-L112】

6. **Modernize frontend exchange UX**  
   Update key management, workflow setup, and balance displays to reflect the new abstraction: surface exchange capabilities, allow futures configuration, and expose Bybit-only actions alongside Binance. Ensure hooks and components fetch data from the new endpoints while keeping copy localized.【F:frontend/src/components/forms/ExchangeApiKeySection.tsx†L1-L48】【F:frontend/src/lib/usePrerequisites.ts†L1-L206】【F:frontend/src/routes/PortfolioWorkflowSetup.tsx†L1-L258】

7. **Backfill tests and documentation**  
   Add unit/integration coverage for the abstraction adapters, orchestration changes, and new routes. Update user-facing docs or onboarding copy to explain exchange selection, futures-only constraints, and any new prerequisites.【F:backend/test/binance-orders.test.ts†L1-L120】【F:frontend/src/lib/usePrerequisites.ts†L1-L206】
