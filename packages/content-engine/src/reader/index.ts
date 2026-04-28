import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { Publication, PublicationFrontmatter } from './types';

function mdToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .split('\n\n')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      if (p.startsWith('<h') || p.startsWith('<li') || p.startsWith('<blockquote')) return p;
      if (p.includes('<li>')) return `<ul>${p}</ul>`;
      return `<p>${p}</p>`;
    })
    .join('\n');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function slugFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

function parsePublication(filePath: string): Publication | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const fm = data as PublicationFrontmatter;

    if (!fm.title || !fm.published_at) return null;

    const htmlContent = mdToHtml(content);
    const plainText = stripHtml(htmlContent);
    const excerpt = plainText.slice(0, 160).trimEnd();
    const slug = slugFromFilename(filePath);

    return {
      slug,
      title: fm.title,
      description: fm.description ?? '',
      author: fm.author ?? '',
      published_at: fm.published_at,
      updated_at: fm.updated_at,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      domain: fm.domain ?? '',
      reading_time: fm.reading_time ?? 0,
      hero_image: fm.hero_image,
      htmlContent,
      excerpt,
    };
  } catch {
    return null;
  }
}

export function getAllPublications(contentDir: string): Publication[] {
  if (!fs.existsSync(contentDir)) return [];

  const files = fs
    .readdirSync(contentDir)
    .filter(f => f.endsWith('.mdx') || f.endsWith('.md'));

  const publications = files
    .map(f => parsePublication(path.join(contentDir, f)))
    .filter((p): p is Publication => p !== null);

  return publications.sort(
    (a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
}

export function getPublication(
  contentDir: string,
  slug: string
): Publication | null {
  const mdxPath = path.join(contentDir, `${slug}.mdx`);
  const mdPath = path.join(contentDir, `${slug}.md`);

  if (fs.existsSync(mdxPath)) return parsePublication(mdxPath);
  if (fs.existsSync(mdPath)) return parsePublication(mdPath);
  return null;
}
