# pokerzeno-site-template

Production-ready Next.js starter for PokerZeno framework sites.

## Scaffold a New Site

```bash
./scripts/new-site.sh ../my-new-site "MySiteName"
```

## Framework

This template is part of the PokerZeno framework. See `pokerzeno-framework` repo for standards, ADRs, and runbooks.

## Stack

- Next.js 15 (static export)
- Tailwind CSS (royal palette + card themes)
- TypeScript strict
- Cloudflare Pages deployment
- `@pokerzeno/*` plugins

## Quick Start

```bash
cp .env.example .env.local
# Edit .env.local
npm install
npm run dev
```

## Verify

```bash
npm run verify:all
```
