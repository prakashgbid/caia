export interface LicenseInfo {
  name: string;
  url?: string;
  attributionRequired: boolean;
  photographer?: string;
  photographerUrl?: string;
}

export interface SourceImage {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  alt: string;
  license: LicenseInfo;
  provider: string;
  sourceUrl: string;
}

export interface SourceVideo {
  id: string;
  url: string;       // direct mp4 URL
  previewUrl: string;
  width: number;
  height: number;
  duration: number;  // seconds
  alt: string;
  license: LicenseInfo;
  provider: string;
  sourceUrl: string;
}
