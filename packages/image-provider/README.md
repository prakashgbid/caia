# @pokerzeno/image-provider

Supply real photo-quality imagery to your websites. Searches free stock sources first, falls back to AI generation, validates quality, uploads to Cloudflare R2, and tracks everything in a shared manifest for cross-site reuse.

---

## Install

```bash
npm install
npm run build
```

Link for local CLI use:

```bash
npm link
image-provider --help
```

---

## Configure

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

### Required keys & where to get them

| Key | Service | Free tier | Sign-up URL |
|-----|---------|-----------|-------------|
| `UNSPLASH_ACCESS_KEY` | Unsplash | 50 req/hr | https://unsplash.com/developers |
| `PEXELS_API_KEY` | Pexels | 200 req/hr | https://www.pexels.com/api/ |
| `PIXABAY_API_KEY` | Pixabay | 100 req/min | https://pixabay.com/api/docs/ |
| `FAL_KEY` | fal.ai (AI gen) | Pay-as-you-go | https://fal.ai/dashboard/keys |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Free | https://dash.cloudflare.com/ |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 | 10 GB free | R2 → Manage R2 API tokens |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 | — | R2 → Manage R2 API tokens |
| `R2_BUCKET` | Cloudflare R2 | — | R2 → Create bucket |
| `R2_PUBLIC_BASE_URL` | Cloudflare R2 | — | Bucket → Settings → Public access |

**Only 3 of the 9 sources require API keys.** If a key is missing, that source is skipped with a warning — you don't need all three web sources to function. You only need `FAL_KEY` if web sources fail to find a passing image.

R2 keys are only needed when actually storing images (not needed for `search` or `validate` commands).

---

## CLI commands

### `acquire` — Find and store an image

```bash
image-provider acquire \
  --query "poker chips stacked on green felt" \
  --site poker-zeno \
  --slot hero \
  --hero
```

Options:
- `--query <text>` — description of the image *(required)*
- `--site <name>` — your site identifier *(required)*
- `--slot <name>` — where this image will be used *(required)*
- `--hero` — use FLUX.1-pro for AI generation (~$0.05/img vs $0.003/img default)
- `--dry-run` — search and validate without storing or updating the manifest

**Flow:**
1. Check manifest for a similar image (keyword similarity ≥ 70%) → reuse if found
2. Search Unsplash + Pexels + Pixabay in parallel
3. Download top candidates, run validation pipeline (dimensions, sharpness, CLIP relevance, aesthetic score)
4. First passing candidate is uploaded to R2 in 5 variants (mobile/tablet/desktop/4k WebP + original JPEG)
5. If no web candidate passes → generate via fal.ai FLUX.1-schnell (or FLUX.1-pro with `--hero`)
6. If AI also fails → show top 3 candidates and ask you to pick

### `list` — Show all tracked images

```bash
image-provider list
image-provider list --site poker-zeno
```

### `reuse` — Add an existing image to a new slot

```bash
image-provider reuse \
  --id poker-chips-stacked-on-green-felt-a1b2 \
  --site roulette-community \
  --slot hero
```

No re-fetching. Just adds a usage entry to the manifest.

### `credits` — Print attribution for a site

```bash
image-provider credits --site poker-zeno
```

Use this output to populate your `/image-credits` page.

### `budget` — Check AI generation spend

```bash
image-provider budget
```

Shows cap ($1.00 by default), amount spent, remaining budget, and recent ledger entries.

### `search` — Preview candidates without downloading

```bash
image-provider search "roulette wheel casino"
image-provider search "poker cards" --per-page 5
```

Dry-run: shows what sources return without downloading, validating, or storing anything.

### `validate` — Test validation on a local file

```bash
image-provider validate /path/to/image.jpg
image-provider validate /path/to/image.jpg --query "poker chips"
```

Useful for diagnosing why an image was rejected.

---

## Library API

Import in your Next.js or Node app:

```ts
import {
  getImageForSlot,
  renderImgTag,
  getSiteCredits,
} from '@pokerzeno/image-provider';

// Get the image record for a specific slot
const record = getImageForSlot('poker-zeno', 'hero');
if (record) {
  const { src, srcset, sizes, alt, credit } = renderImgTag(record);
  // Use in <img> or Next.js <Image>
}

// Get all credits for the /image-credits page
const credits = getSiteCredits('poker-zeno');
```

### Next.js integration example

```tsx
// app/components/HeroImage.tsx
import { getImageForSlot, renderImgTag } from '@pokerzeno/image-provider';

export function HeroImage() {
  const record = getImageForSlot('poker-zeno', 'hero');
  if (!record) return null;

  const { src, srcset, sizes, alt, credit } = renderImgTag(record);

  return (
    <figure className="relative">
      <img
        src={src}
        srcSet={srcset}
        sizes={sizes}
        alt={alt}
        className="w-full h-full object-cover"
      />
      {credit?.photographer && (
        <figcaption className="absolute bottom-2 right-2 text-xs text-white/60 hover:text-white/90 transition-opacity opacity-0 hover:opacity-100">
          Photo by{' '}
          <a href={credit.photographerUrl} target="_blank" rel="noopener noreferrer">
            {credit.photographer}
          </a>
        </figcaption>
      )}
    </figure>
  );
}
```

### /image-credits page example

```tsx
// app/image-credits/page.tsx
import { getSiteCredits } from '@pokerzeno/image-provider';

export default function ImageCreditsPage() {
  const credits = getSiteCredits('poker-zeno');

  return (
    <main>
      <h1>Image Credits</h1>
      <ul>
        {credits.map(c => (
          <li key={`${c.imageId}-${c.slot}`}>
            <strong>{c.slot}</strong>: {c.alt}
            {c.photographer && (
              <> — Photo by{' '}
                <a href={c.photographerUrl} target="_blank" rel="noopener noreferrer">
                  {c.photographer}
                </a>
              </>
            )}
            {' '}(<a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a>)
          </li>
        ))}
      </ul>
    </main>
  );
}
```

---

## Manifest

All acquired images are tracked in `manifest/images.json`. This file is source-controlled — commit it alongside your code. Both sites read from the same manifest, enabling cross-site image reuse at zero cost.

**Never delete the manifest** without also cleaning up R2 (use `image-provider list` to audit).

---

## Budget

The hard AI spend cap is `$1.00` (configurable via `BUDGET_CAP_USD` in `.env`). The ledger is in `budget/ledger.json`. Run `image-provider budget` to see your current position.

**Typical costs:**
- Web source image: $0.00 (free)
- FLUX.1-schnell (standard): ~$0.003/image
- FLUX.1-pro (hero): ~$0.05/image

With the $1.00 cap you can generate up to ~333 standard images or ~20 hero images from AI before the cap is hit. In practice, most images come from the free web sources.

---

## Development

```bash
npm run build     # compile TypeScript → dist/
npm test          # run vitest test suite
npm run typecheck # type-check without building
npm run dev       # watch mode
```

---

## Smoke test (no API keys needed)

```bash
# Build first
npm run build

# Check CLI loads
node dist/cli/index.js --help

# Budget shows zero spend
node dist/cli/index.js budget

# List shows empty manifest
node dist/cli/index.js list

# Search (will warn about missing keys but won't crash)
node dist/cli/index.js search "poker chips" 2>/dev/null || true
```

---

## Secrets

`.env` is gitignored and never committed. Source of truth is the credential store on `stolution`.

### Vault layout (stolution:/home/s903/.vault/)

Flat-file vault — one `.env` file per service, all `chmod 600`.

| File | Contents |
|------|----------|
| `image-provider-unsplash.env` | `UNSPLASH_ACCESS_KEY` |
| `image-provider-pexels.env` | `PEXELS_API_KEY` |
| `image-provider-fal.env` | `FAL_KEY` |
| `image-provider-cloudflare-api-token.env` | `CLOUDFLARE_API_TOKEN` (cfat_ token, R2 admin read/write) |
| `image-provider-cloudflare-r2.env` | `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` |

**Storage auth:** the package uses `CLOUDFLARE_API_TOKEN` directly via the CF REST API for R2 object operations (Path B). No S3 credentials are required — Cloudflare does not expose an API endpoint to mint them programmatically.

### Re-pull credentials from vault

```bash
bash scripts/pull-secrets.sh
```

Reads all vault files from `stolution` over SSH and regenerates `.env` atomically. Safe to re-run at any time.

### R2 setup (already complete)

R2 is live. Bucket `site-images` (APAC), managed r2.dev public access enabled:

```
Public URL: https://pub-ceeb8a412d2a49248da54897e3d44472.r2.dev
```

If the bucket or token ever needs to be recreated, run `bash scripts/setup-r2.sh` (bucket + public URL), then store a new `cfat_` token in the vault and re-run `pull-secrets.sh`.

---

## License

Copyright © 2026 PokerZeno / Roulette Community. All rights reserved. Proprietary — see LICENSE.
