import { schedule } from 'node-cron';
import buildServer from '../src/server.js';
import '../src/util/env.js';
import reviewPortfolios from '../src/workflows/portfolio-review.js';
import checkOpenOrders from '../src/jobs/check-open-orders.js';
import fetchNews from '../src/jobs/fetch-news.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const routesDir = path.join(__dirname, '../src/routes');
  const app = await buildServer(routesDir);
  const log = app.log;

  schedule('*/10 * * * *', () => fetchNews(log));
  schedule('*/3 * * * *', () => checkOpenOrders(log));

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

  try {
    // Listen on all interfaces so Caddy can reach the backend in Docker
    await app.listen({ port: 3000, host: '0.0.0.0' });
    app.isStarted = true;
    log.info('server started');
  } catch (err) {
    log.error(err);
    process.exit(1);
  }
}

main();
