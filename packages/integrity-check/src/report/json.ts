import * as fs from 'fs';
import * as path from 'path';
import type { ScanResult } from '../types';

const REPORTS_DIR = path.join(process.cwd(), 'integrity-reports');

export function writeJsonReport(result: ScanResult, outputPath?: string): string {
  const dir = outputPath ? path.dirname(outputPath) : REPORTS_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath =
    outputPath ??
    path.join(dir, `integrity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}

export function readJsonReport(filePath: string): ScanResult {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
