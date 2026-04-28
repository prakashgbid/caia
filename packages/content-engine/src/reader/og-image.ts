import type { Publication } from './types';

export function resolveOGImageUrl(
  pub: Publication,
  r2BaseUrl: string = 'https://assets.pokerzeno.com'
): string {
  if (pub.hero_image) {
    if (pub.hero_image.startsWith('http')) return pub.hero_image;
    return `${r2BaseUrl}/${pub.hero_image}`;
  }
  return `${r2BaseUrl}/og/publications-default.jpg`;
}
