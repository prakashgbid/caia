import { getImagesBySite, type ImageRecord } from '../manifest/index.js';

export type { ImageRecord } from '../manifest/index.js';

export function getImageForSlot(siteName: string, slotName: string): ImageRecord | null {
  const images = getImagesBySite(siteName);
  return (
    images.find(img =>
      img.usages.some(u => u.site === siteName && u.slot === slotName),
    ) ?? null
  );
}

export interface ImgTagData {
  src: string;
  srcset: string;
  sizes: string;
  alt: string;
  credit?: {
    photographer?: string;
    photographerUrl?: string;
    licenseName: string;
    licenseUrl?: string;
    sourceUrl?: string;
  };
}

export function renderImgTag(record: ImageRecord): ImgTagData {
  const { variants } = record.storage;

  const srcsetParts = [
    variants.mobile && `${variants.mobile} 640w`,
    variants.tablet && `${variants.tablet} 1024w`,
    variants.desktop && `${variants.desktop} 1920w`,
    variants['4k'] && `${variants['4k']} 3840w`,
  ].filter(Boolean);

  const srcset = srcsetParts.join(', ');
  const sizes = '(max-width: 640px) 640px, (max-width: 1024px) 1024px, (max-width: 1920px) 1920px, 3840px';

  const credit =
    record.license.attributionRequired || record.license.photographer
      ? {
          photographer: record.license.photographer,
          photographerUrl: record.license.photographerUrl,
          licenseName: record.license.name,
          licenseUrl: record.license.url,
          sourceUrl: record.source.sourceUrl,
        }
      : undefined;

  return {
    src: variants.desktop || variants.original || '',
    srcset,
    sizes,
    alt: record.alt,
    credit,
  };
}

export interface CreditEntry {
  imageId: string;
  alt: string;
  slot: string;
  photographer?: string;
  photographerUrl?: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

export function getSiteCredits(siteName: string): CreditEntry[] {
  const images = getImagesBySite(siteName);
  return images.flatMap(img =>
    img.usages
      .filter(u => u.site === siteName)
      .map(u => ({
        imageId: img.id,
        alt: img.alt,
        slot: u.slot,
        photographer: img.license.photographer,
        photographerUrl: img.license.photographerUrl,
        license: img.license.name,
        licenseUrl: img.license.url,
        sourceUrl: img.source.sourceUrl,
      })),
  );
}
