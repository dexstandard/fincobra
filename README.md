# FinCobra

FinCobra is a playground for experimenting with AI‑assisted crypto trading
agents. Users write natural‑language prompts that describe a strategy, and an
OpenAI model plans token swaps accordingly. Trades execute on Binance using the
user's encrypted API keys. A Fastify backend schedules agents and records
results while a React dashboard lets users manage agents and inspect their
activity.

**Try the beta server:** [https://fincobra.com/](https://fincobra.com/)

## User flow

1. Sign in with Google and add your Binance API key pair.
2. Create an agent by choosing a token pair, setting a spend limit, and writing
   a prompt that explains how the agent should trade.
3. The scheduler periodically loads active agents, plans a swap with OpenAI,
   simulates the trade, executes it on Binance, and stores the outcome and model
   logs.
4. Use the dashboard to review trades, inspect prompt/response logs, or pause
   and delete agents.

## Features

- Encrypted storage of Binance API keys secured with a user password.
- Allow‑listed token pairs and trade limits to reduce risk.
- Detailed logs for plan, simulation, and execution steps.
- Web dashboard for creating, pausing, and deleting agents.

## Running tests locally

The backend tests require a PostgreSQL instance. You can run one quickly with Docker:

1. Start PostgreSQL:
   ```bash
   docker run --rm --name fincobra-pg \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=fincobra_test \
     -p 5432:5432 \
     postgres:16
   ```

2. In another terminal, run the tests:
   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/fincobra_test \
      npm --prefix backend test
   ```