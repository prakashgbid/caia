import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { discoverRoutes, discoverStaticRoutes } from '../../src/crawl/route-discovery';

// Use the actual poker-zeno project as a fixture
const POKER_ZENO = path.resolve(__dirname, '../../../poker-zeno');
const ROULETTE = path.resolve(__dirname, '../../../roulette-community');

describe('discoverRoutes — poker-zeno', () => {
  it('finds at least 15 routes', async () => {
    const routes = await discoverRoutes(POKER_ZENO);
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it('includes home route', async () => {
    const routes = await discoverRoutes(POKER_ZENO);
    const paths = routes.map((r) => r.urlPath);
    expect(paths).toContain('/');
  });

  it('includes /play route', async () => {
    const routes = await discoverRoutes(POKER_ZENO);
    const paths = routes.map((r) => r.urlPath);
    expect(paths).toContain('/play');
  });

  it('marks dynamic routes as isDynamic', async () => {
    const routes = await discoverRoutes(POKER_ZENO);
    const dynamic = routes.filter((r) => r.isDynamic);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.every((r) => r.urlPath.includes('['))).toBe(true);
  });
});

describe('discoverStaticRoutes — roulette-community', () => {
  it('returns only non-dynamic routes', async () => {
    const routes = await discoverStaticRoutes(ROULETTE);
    expect(routes.every((r) => !r.includes('['))).toBe(true);
  });
});
