import { schedule } from 'node-cron';
import type { FastifyInstance } from 'fastify';
import buildServer from '../src/server.js';
import '../src/util/env.js';
import reviewPortfolios from '../src/workflows/portfolio-review.js';
import { syncOpenOrderStatuses } from '../src/services/order-orchestrator.js';
import { fetchAndStoreNews } from '../src/services/news.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const routesDir = path.join(__dirname, '../src/routes');
  let app: FastifyInstance | undefined;

  try {
    app = await buildServer(routesDir);
    const { log } = app;

    schedule('*/10 * * * *', () => fetchAndStoreNews(log));
    schedule('*/3 * * * *', () => syncOpenOrderStatuses(log));

    const schedules: Record<string, string> = {
      '10m': '*/10 * * * *',
      '15m': '*/15 * * * *',
      '30m': '*/30 * * * *',
      '1h': '0 * * * *',
      '3h': '0 */3 * * *',
      '5h': '0 */5 * * *',
      '12h': '0 */12 * * *',
      '24h': '0 0 * * *',
      '3d': '0 0 */3 * *',
      '1w': '0 0 * * 0',
    };

    for (const [interval, cronExp] of Object.entries(schedules)) {
      schedule(cronExp, () => reviewPortfolios(log, interval));
    }

    // Listen on all interfaces so Caddy can reach the backend in Docker
    await app.listen({ port: 3000, host: '0.0.0.0' });
    app.isStarted = true;
    log.info('server started');
  } catch (err) {
    if (app) {
      app.log.error(err);
    } else {
      console.error(err);
    }

    if (!app?.isStarted) {
      process.exit(1);
    }
  }
}

void main();
