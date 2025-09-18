import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/objectCase.js';
import type { NewsEntry, NewsInsert } from './news.types.js';

export async function insertNews(items: NewsInsert[]): Promise<void> {
  const filtered = items.filter((i) => i.tokens.length);
  if (!filtered.length) return;
  const params: (string | string[] | null)[] = [];
  const values: string[] = [];
  filtered.forEach((item, i) => {
    const base = i * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(item.title, item.link, item.pubDate ?? null, item.tokens);
  });
  await db.query(
    `INSERT INTO news (title, link, pub_date, tokens)
     VALUES ${values.join(', ')}
      ON CONFLICT (link) DO NOTHING`,
    params,
  );
}

export async function getNewsByToken(
  token: string,
  limit = 20,
): Promise<NewsEntry[]> {
  const { rows } = await db.query(
    `SELECT title, link, pub_date
       FROM news
      WHERE tokens @> ARRAY[$1]::text[]
   ORDER BY pub_date DESC NULLS LAST
      LIMIT $2`,
    [token, limit],
  );
  return convertKeysToCamelCase(rows) as NewsEntry[];
}
