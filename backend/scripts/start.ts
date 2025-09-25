import { schedule, type ScheduledTask } from 'node-cron';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
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
  const cronTasks: ScheduledTask[] = [];
  let isShuttingDown = false;

  const registerCron = (expression: string, job: () => void) => {
    const task = schedule(expression, job);
    cronTasks.push(task);
    return task;
  };

  const stopCronJobs = (log?: FastifyBaseLogger) => {
    while (cronTasks.length > 0) {
      const task = cronTasks.pop();
      if (!task) continue;

      try {
        task.stop();
        const candidate = task as unknown as { destroy?: () => void };
        if (typeof candidate.destroy === 'function') {
          candidate.destroy();
        }
      } catch (err) {
        log?.error({ err }, 'failed to stop cron job');
      }
    }
  };

  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    const logger = app?.log;

    logger?.info({ signal }, 'received shutdown signal');
    stopCronJobs(logger);

    try {
      if (app) {
        await app.close();
        logger?.info('server stopped');
      }
    } catch (err) {
      logger?.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    app = await buildServer(routesDir);
    const { log } = app;

    registerCron('*/10 * * * *', () => fetchAndStoreNews(log));
    registerCron('*/3 * * * *', () => syncOpenOrderStatuses(log));

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
      registerCron(cronExp, () => reviewPortfolios(log, interval));
    }

    // Listen on all interfaces so Caddy can reach the backend in Docker
    await app.listen({ port: 3000, host: '0.0.0.0' });
    app.isStarted = true;
    log.info('server started');
  } catch (err) {
    stopCronJobs(app?.log);

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
