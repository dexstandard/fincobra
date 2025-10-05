import { db } from '../db/index.js';
import { convertKeysToCamelCase } from '../util/object-case.js';
import type { SocialPost, SocialPostInsert } from './social-posts.types.js';

export async function insertSocialPosts(items: SocialPostInsert[]): Promise<void> {
  const filtered = items.filter((item) => item.tokens.length && item.text.trim().length);
  if (!filtered.length) {
    return;
  }

  const params: (string | string[] | number | null)[] = [];
  const values: string[] = [];

  filtered.forEach((item, index) => {
    const base = index * 9;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
    params.push(
      item.tweetId,
      item.username,
      item.displayName ?? null,
      item.profileImageUrl ?? null,
      item.text,
      item.permalink ?? null,
      item.postedAt,
      item.tokens,
      item.weight,
    );
  });

  await db.query(
    `INSERT INTO social_posts (tweet_id, username, display_name, profile_image_url, text, permalink, posted_at, tokens, weight)
     VALUES ${values.join(', ')}
     ON CONFLICT (tweet_id) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           profile_image_url = EXCLUDED.profile_image_url,
           text = EXCLUDED.text,
           permalink = EXCLUDED.permalink,
           posted_at = EXCLUDED.posted_at,
           tokens = EXCLUDED.tokens,
           weight = EXCLUDED.weight`,
    params,
  );
}

export async function getRecentSocialPostsByToken(
  token: string,
  limit = 20,
): Promise<SocialPost[]> {
  const { rows } = await db.query(
    `SELECT id, tweet_id, username, display_name, profile_image_url, text, permalink, posted_at, tokens, weight, collected_at
       FROM social_posts
      WHERE tokens @> ARRAY[$1]::text[]
   ORDER BY posted_at DESC
      LIMIT $2`,
    [token, limit],
  );
  return convertKeysToCamelCase(rows) as SocialPost[];
}
