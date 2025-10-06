import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://localhost:5432/postgres'),
  KEY_PASSWORD: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  TWITTER_USERNAME: z.string().optional(),
  TWITTER_PASSWORD: z.string().optional(),
  TWITTER_EMAIL: z.string().optional(),
  TWITTER_2FA_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);
