import { Scraper } from 'agent-twitter-client';
import type { Tweet } from 'agent-twitter-client';
import type { FastifyBaseLogger } from 'fastify';
import type { SocialSource } from './social.types.js';
import { env } from '../util/env.js';
import { insertSocialPosts } from '../repos/social-posts.js';
import type { SocialPostInsert } from '../repos/social-posts.types.js';

const SOCIAL_SOURCES: SocialSource[] = [
  { username: 'bitcoin', displayName: 'Bitcoin', tokens: ['BTC'], weight: 0.95 },
  { username: 'BTC_Archive', displayName: 'BTC Archive', tokens: ['BTC'], weight: 0.75 },
  { username: 'saylor', displayName: 'Michael Saylor', tokens: ['BTC'], weight: 0.7 },
  { username: 'cz_binance', displayName: 'CZ 🔶 Binance', tokens: ['BNB'], weight: 0.95 },
  { username: 'binance', displayName: 'Binance', tokens: ['BNB'], weight: 0.9 },
  { username: 'BNBCHAIN', displayName: 'BNB Chain', tokens: ['BNB'], weight: 0.85 },
  { username: 'dogecoin', displayName: 'Dogecoin', tokens: ['DOGE'], weight: 0.9 },
  { username: 'dogecoinfdn', displayName: 'Dogecoin Foundation', tokens: ['DOGE'], weight: 0.8 },
  { username: 'BillyM2k', displayName: 'Shibetoshi Nakamoto', tokens: ['DOGE'], weight: 0.7 },
  { username: 'ethereum', displayName: 'Ethereum', tokens: ['ETH'], weight: 0.95 },
  { username: 'VitalikButerin', displayName: 'Vitalik Buterin', tokens: ['ETH'], weight: 0.9 },
  { username: 'Consensys', displayName: 'Consensys', tokens: ['ETH'], weight: 0.75 },
  { username: 'hedera', displayName: 'Hedera', tokens: ['HBAR'], weight: 0.95 },
  { username: 'HBAR_foundation', displayName: 'HBAR Foundation', tokens: ['HBAR'], weight: 0.85 },
  { username: 'SwirldsLabs', displayName: 'Swirlds Labs', tokens: ['HBAR'], weight: 0.75 },
  { username: 'pepecoineth', displayName: 'Pepe Coin', tokens: ['PEPE'], weight: 0.9 },
  { username: 'pepecommunity', displayName: 'PEPE Community', tokens: ['PEPE'], weight: 0.75 },
  { username: 'lordkeklol', displayName: 'Lord Kek', tokens: ['PEPE'], weight: 0.7 },
  { username: 'Shibtoken', displayName: 'Shib', tokens: ['SHIB'], weight: 0.95 },
  { username: 'ShibariumNet', displayName: 'Shibarium Network', tokens: ['SHIB'], weight: 0.85 },
  { username: 'ShibArmy', displayName: 'Shib Army', tokens: ['SHIB'], weight: 0.75 },
  { username: 'solana', displayName: 'Solana', tokens: ['SOL'], weight: 0.95 },
  { username: 'SolanaFndn', displayName: 'Solana Foundation', tokens: ['SOL'], weight: 0.85 },
  { username: 'aeyakovenko', displayName: 'Anatoly Yakovenko', tokens: ['SOL'], weight: 0.75 },
  { username: 'ton_blockchain', displayName: 'TON 💎', tokens: ['TON'], weight: 0.95 },
  { username: 'ton_status', displayName: 'TON Status', tokens: ['TON'], weight: 0.8 },
  { username: 'ton_society', displayName: 'TON Society', tokens: ['TON'], weight: 0.7 },
  { username: 'trondao', displayName: 'TRON DAO', tokens: ['TRX'], weight: 0.9 },
  { username: 'justinsuntron', displayName: 'Justin Sun', tokens: ['TRX'], weight: 0.85 },
  { username: 'tronscan_org', displayName: 'TRONSCAN', tokens: ['TRX'], weight: 0.75 },
  { username: 'Ripple', displayName: 'Ripple', tokens: ['XRP'], weight: 0.95 },
  { username: 'XRPLLabs', displayName: 'XRPL Labs', tokens: ['XRP'], weight: 0.8 },
  { username: 'XRP_community', displayName: 'XRP Community', tokens: ['XRP'], weight: 0.7 },
  { username: 'Tether_to', displayName: 'Tether', tokens: ['USDT'], weight: 0.95 },
  { username: 'paoloardoino', displayName: 'Paolo Ardoino', tokens: ['USDT'], weight: 0.85 },
  { username: 'TetherGoldToken', displayName: 'Tether Gold', tokens: ['USDT'], weight: 0.7 },
  { username: 'circle', displayName: 'Circle', tokens: ['USDC'], weight: 0.95 },
  { username: 'centre_io', displayName: 'Centre', tokens: ['USDC'], weight: 0.8 },
  { username: 'jerallaire', displayName: 'Jeremy Allaire', tokens: ['USDC'], weight: 0.75 },
];

const SOCIAL_WEIGHTS: Record<string, number> = SOCIAL_SOURCES.reduce(
  (acc, source) => {
    acc[source.username.toLowerCase()] = source.weight;
    return acc;
  },
  {} as Record<string, number>,
);

let scraperPromise: Promise<Scraper> | null = null;
let scraperInstance: Scraper | null = null;
let loginFailureCount = 0;
let nextLoginAttemptAt = 0;

function calculateBackoffDelayMs(attempt: number): number {
  const baseDelayMs = 10_000;
  const maxDelayMs = 60 * 60 * 1000;
  const exponent = Math.max(0, attempt - 1);
  const delay = baseDelayMs * 2 ** exponent;
  return Math.min(delay, maxDelayMs);
}

async function getScraper(log?: FastifyBaseLogger): Promise<Scraper | null> {
  const username = env.TWITTER_USERNAME;
  const password = env.TWITTER_PASSWORD;
  const email = env.TWITTER_EMAIL;
  const twoFactorSecret = env.TWITTER_2FA_SECRET;

  if (!username || !password) {
    log?.warn('Twitter credentials are not configured; skipping social sync.');
    return null;
  }

  if (scraperInstance) {
    return scraperInstance;
  }

  const now = Date.now();
  if (now < nextLoginAttemptAt) {
    const waitMs = nextLoginAttemptAt - now;
    log?.warn({ waitMs }, 'delaying twitter scraper login after previous failure');
    return null;
  }

  if (!scraperPromise) {
    const loginTask = (async () => {
      const client = new Scraper();
      await client.login(username, password, email, twoFactorSecret);
      loginFailureCount = 0;
      nextLoginAttemptAt = 0;
      return client;
    })();

    scraperPromise = loginTask.catch((err: unknown) => {
      loginFailureCount += 1;
      const delayMs = calculateBackoffDelayMs(loginFailureCount);
      nextLoginAttemptAt = Date.now() + delayMs;
      log?.error(
        { err, delayMs, attempt: loginFailureCount },
        'twitter scraper login failed; scheduling retry',
      );
      throw err;
    });
  }

  try {
    scraperInstance = await scraperPromise;
    return scraperInstance;
  } catch (err) {
    scraperPromise = null;
    scraperInstance = null;
    log?.error({ err }, 'failed to initialize twitter scraper');
    throw err;
  }
}

function extractPostedAt(tweet: Tweet): string | null {
  if (tweet.timeParsed instanceof Date && !Number.isNaN(tweet.timeParsed.valueOf())) {
    return tweet.timeParsed.toISOString();
  }
  if (typeof tweet.timestamp === 'number') {
    const ms = tweet.timestamp * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

async function collectTweetsForSource(
  scraper: Scraper,
  source: SocialSource,
): Promise<SocialPostInsert[]> {
  const posts: SocialPostInsert[] = [];
  let fetched = 0;

  for await (const tweet of scraper.getTweets(source.username, 5)) {
    if (!tweet || !tweet.id || !tweet.text) {
      continue;
    }
    if (tweet.isRetweet) {
      continue;
    }

    const postedAt = extractPostedAt(tweet);
    if (!postedAt) {
      continue;
    }

    const trimmed = tweet.text.trim();
    if (!trimmed.length) {
      continue;
    }

    posts.push({
      tweetId: tweet.id,
      username: tweet.username ?? source.username,
      displayName: tweet.name ?? source.displayName ?? null,
      profileImageUrl: null,
      text: trimmed,
      permalink: tweet.permanentUrl ?? null,
      postedAt,
      tokens: source.tokens,
      weight: source.weight,
    });
    fetched++;
    if (fetched >= 3) {
      break;
    }
  }

  return posts;
}

export async function fetchAndStoreSocialPosts(
  log: FastifyBaseLogger,
): Promise<void> {
  let scraper: Scraper | null = null;
  try {
    scraper = await getScraper(log);
    if (!scraper) {
      return;
    }

    const collected: SocialPostInsert[] = [];
    const perSource: Record<string, number> = {};

    for (const source of SOCIAL_SOURCES) {
      try {
        const posts = await collectTweetsForSource(scraper, source);
        perSource[source.username] = posts.length;
        collected.push(...posts);
      } catch (err) {
        perSource[source.username] = 0;
        log.error({ err, source: source.username }, 'failed to fetch tweets for source');
        scraperInstance = null;
        scraperPromise = null;

        try {
          scraper = await getScraper(log);
          if (!scraper) {
            break;
          }
        } catch (reauthError) {
          log.error({ err: reauthError }, 'failed to reauthenticate twitter scraper');
          throw reauthError;
        }
      }
    }

    if (collected.length) {
      await insertSocialPosts(collected);
    }

    log.info(
      {
        totalSources: SOCIAL_SOURCES.length,
        totalCollected: collected.length,
        perSource,
      },
      'social post fetch summary',
    );
  } catch (err) {
    log.error({ err }, 'failed to fetch or store social posts');
    scraperInstance = null;
    scraperPromise = null;
  }
}

export { SOCIAL_SOURCES, SOCIAL_WEIGHTS };
