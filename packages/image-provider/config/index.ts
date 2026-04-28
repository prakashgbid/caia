import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({ path: resolve(__dirname, '../.env') });

const envSchema = z.object({
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),
  CLOUDFLARE_IMAGES_TOKEN: z.string().optional(),
  STORAGE_BACKEND: z.enum(['r2', 'cloudflare-images']).default('r2'),
  BUDGET_CAP_USD: z.string().default('1.00'),
});

export type Config = z.infer<typeof envSchema>;

const SIGNUP_URLS: Partial<Record<string, string>> = {
  UNSPLASH_ACCESS_KEY: 'https://unsplash.com/developers',
  PEXELS_API_KEY: 'https://www.pexels.com/api/',
  PIXABAY_API_KEY: 'https://pixabay.com/api/docs/',
  FAL_KEY: 'https://fal.ai/dashboard/keys',
  CLOUDFLARE_ACCOUNT_ID: 'https://dash.cloudflare.com/ (right sidebar)',
  R2_ACCESS_KEY_ID: 'https://dash.cloudflare.com/ → R2 → Manage R2 API tokens',
  R2_SECRET_ACCESS_KEY: 'https://dash.cloudflare.com/ → R2 → Manage R2 API tokens',
  R2_BUCKET: 'https://dash.cloudflare.com/ → R2 → Create bucket',
  R2_PUBLIC_BASE_URL: 'Your R2 bucket public URL (enable public access in bucket settings)',
};

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Config validation failed: ${missing}`);
  }
  _config = result.data;
  return _config;
}

export function requireKey(key: string): string {
  const cfg = getConfig();
  const val = (cfg as Record<string, unknown>)[key];
  if (!val || typeof val !== 'string') {
    const url = SIGNUP_URLS[key];
    const hint = url ? `\n  Get one at: ${url}` : '';
    throw new Error(`Missing required env var: ${key}${hint}`);
  }
  return val;
}

export function getCapUsd(): number {
  return parseFloat(getConfig().BUDGET_CAP_USD);
}
