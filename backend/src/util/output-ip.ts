import type { FastifyBaseLogger } from 'fastify';

let outputIp = 'unknown';
let fetched = false;

export async function fetchOutputIp(log?: FastifyBaseLogger): Promise<string> {
  if (!fetched) {
    fetched = true;
    try {
      const res = await fetch('https://api.ipify.org');
      outputIp = await res.text();
    } catch (err) {
      log?.error({ err }, 'failed to fetch output ip');
    }
  }
  return outputIp;
}

export function getOutputIp(): string {
  return outputIp;
}
