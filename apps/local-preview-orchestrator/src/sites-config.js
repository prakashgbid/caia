/**
 * Site configuration registry for local preview deployments.
 * Defines the three sites, their repos, ports, build/start commands, and health checks.
 */
export const SITES = [
    {
        name: 'dashboard',
        repo: '/Users/MAC/Documents/projects/caia/apps/dashboard',
        branch: 'develop',
        port: 5173,
        buildCmd: 'pnpm install --frozen-lockfile && pnpm --filter @caia-app/dashboard build',
        startCmd: (p) => `pnpm --filter @caia-app/dashboard exec next start -p ${p}`,
        healthPath: '/',
        healthMustContain: '<title',
        buildArtifacts: ['.next', 'public', 'package.json', 'next.config.js']
    },
    {
        name: 'poker-zeno',
        repo: '/Users/MAC/Documents/projects/poker-zeno',
        branch: 'develop',
        port: 5174,
        buildCmd: 'pnpm install --frozen-lockfile && pnpm build',
        startCmd: (p) => `pnpm preview -- --port ${p}`,
        healthPath: '/',
        healthMustContain: '<html',
        buildArtifacts: ['dist', 'package.json']
    },
    {
        name: 'roulette-community',
        repo: '/Users/MAC/Documents/projects/roulette-community',
        branch: 'develop',
        port: 5175,
        buildCmd: 'pnpm install --frozen-lockfile && pnpm build',
        startCmd: (p) => `pnpm preview -- --port ${p}`,
        healthPath: '/',
        healthMustContain: '<html',
        buildArtifacts: ['dist', 'package.json']
    }
];
export function getSiteConfig(siteName) {
    const config = SITES.find((s) => s.name === siteName);
    if (!config) {
        throw new Error(`Unknown site: ${siteName}`);
    }
    return config;
}
export function getAllSiteNames() {
    return SITES.map((s) => s.name);
}
//# sourceMappingURL=sites-config.js.map