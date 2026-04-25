export interface RegionResult {
  regionName: string;
  selector: string;
  textLength: number;
  childCount: number;
  hasExplicitEmptyState: boolean;
  passed: boolean;
  message: string;
}

export interface ClickResult {
  element: string;
  href?: string;
  triggered: boolean;
  resultUrl?: string;
  domChanged: boolean;
  message: string;
}

export interface DetectorOptions {
  timeout?: number;
  maxNavLinks?: number;
  maxClicks?: number;
  minPageTextLength?: number;
}

export interface DeadShellReport {
  url: string;
  pageLoaded: boolean;
  pageTextLength: number;
  regions: RegionResult[];
  clicks: ClickResult[];
  navLinks: Array<{ href: string; status: number; bodyLength: number; ok: boolean }>;
  overallPassed: boolean;
  summary: string;
}
