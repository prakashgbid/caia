import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';

export interface Route {
  filePath: string;
  /** URL path, e.g. /learn/[slug] */
  urlPath: string;
  isDynamic: boolean;
}

function findAppDir(projectDir: string): string | null {
  const candidates = [
    path.join(projectDir, 'src', 'app'),
    path.join(projectDir, 'app'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

function filePathToUrlPath(relativePagePath: string): string {
  // relativePagePath is like "learn/[slug]/page.tsx" or "page.tsx"
  const dir = path.dirname(relativePagePath);
  if (dir === '.') return '/';

  // Replace Windows separators
  const urlPath = '/' + dir.replace(/\\/g, '/');
  return urlPath;
}

/** Discover all Next.js App Router routes by scanning page.tsx files. */
export async function discoverRoutes(projectDir: string): Promise<Route[]> {
  const appDir = findAppDir(projectDir);
  if (!appDir) return [];

  const pageFiles = await fg('**/page.{tsx,ts,jsx,js}', {
    cwd: appDir,
    ignore: ['**/node_modules/**', '**/_*/**', '**/(.)/**'],
  });

  return pageFiles.map((file) => {
    const urlPath = filePathToUrlPath(file);
    const isDynamic = urlPath.includes('[');
    return {
      filePath: path.join(appDir, file),
      urlPath,
      isDynamic,
    };
  });
}

/** Discover all unique non-dynamic routes (ready to HTTP-probe). */
export async function discoverStaticRoutes(projectDir: string): Promise<string[]> {
  const routes = await discoverRoutes(projectDir);
  return routes.filter((r) => !r.isDynamic).map((r) => r.urlPath);
}
