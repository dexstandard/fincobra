import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgres://localhost:5432/postgres'),
  KEY_PASSWORD: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  ETHEREUM_RPC_URL: z
    .string()
    .url()
    .default('https://eth.llamarpc.com'),
});

export const env = envSchema.parse(process.env);
