import { nanoid } from 'nanoid';
import type { Db } from './connection';
import { projects } from './schema';
import { eq } from 'drizzle-orm';

export const INITIAL_PROJECTS = [
  { name: 'PokerZeno', slug: 'pokerzeno', kind: 'site', liveUrl: 'https://pokerzeno.com', color: '#4CAF50', icon: '♠️' },
  { name: 'Roulette Community', slug: 'roulettecommunity', kind: 'site', liveUrl: 'https://roulettecommunity.com', color: '#E91E63', icon: '🎰' },
  { name: 'Conductor', slug: 'conductor', kind: 'internal', localPath: '/Users/MAC/Documents/projects/conductor', color: '#2196F3', icon: '🎼' },
  { name: 'Image Provider', slug: 'imageprovider', kind: 'plugin', color: '#FF9800', icon: '🖼️' },
  { name: 'Cast Bridge', slug: 'castbridge', kind: 'plugin', color: '#9C27B0', icon: '📡' },
  { name: 'DevInspector', slug: 'devinspector', kind: 'plugin', color: '#00BCD4', icon: '🔍' },
  { name: 'Analytics', slug: 'analytics', kind: 'plugin', color: '#8BC34A', icon: '📊' },
  { name: 'Backend Core', slug: 'backendcore', kind: 'plugin', color: '#607D8B', icon: '⚙️' },
  { name: 'Content Engine', slug: 'contentengine', kind: 'plugin', color: '#FF5722', icon: '📝' },
  { name: 'SEO Program', slug: 'seoprogram', kind: 'plugin', color: '#795548', icon: '🔎' },
  { name: 'Integrity Check', slug: 'integritycheck', kind: 'plugin', color: '#F44336', icon: '✅' },
  { name: 'PokerZeno Framework', slug: 'pokerzeno-framework', kind: 'framework', color: '#3F51B5', icon: '📐' },
] as const;

export async function seedProjects(db: Db): Promise<void> {
  const now = new Date().toISOString();
  for (const proj of INITIAL_PROJECTS) {
    const existing = db.select().from(projects).where(eq(projects.slug, proj.slug)).all();
    if (existing.length > 0) continue;
    db.insert(projects).values({
      id: 'proj_' + nanoid(8),
      name: proj.name,
      slug: proj.slug,
      kind: proj.kind,
      liveUrl: 'liveUrl' in proj ? proj.liveUrl : undefined,
      localPath: 'localPath' in proj ? proj.localPath : undefined,
      status: 'active',
      color: proj.color,
      icon: proj.icon,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}
