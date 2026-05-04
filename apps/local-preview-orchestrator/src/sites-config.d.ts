/**
 * Site configuration registry for local preview deployments.
 * Defines the three sites, their repos, ports, build/start commands, and health checks.
 */
export interface SiteConfig {
    name: string;
    repo: string;
    branch: string;
    port: number;
    buildCmd: string;
    startCmd: (port: number) => string;
    healthPath: string;
    healthMustContain: string;
    buildArtifacts: string[];
}
export declare const SITES: SiteConfig[];
export declare function getSiteConfig(siteName: string): SiteConfig;
export declare function getAllSiteNames(): string[];
//# sourceMappingURL=sites-config.d.ts.map