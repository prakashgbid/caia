/**
 * Renders the three IA outputs as collapsible accordion cards:
 *   - pages-catalogue (sitemap + template + section stacks)
 *   - design-system   (color/typography/spacing tokens + dark/light)
 *   - components-library (Atomic-Design catalogue)
 *
 * Each artifact is shown as pretty-printed JSON inside its content
 * panel — the customer's job at this step is *acceptance*, not editing.
 */
'use client';

import * as React from 'react';
import { Accordion, AccordionItem } from './ui';

export interface IaArtifacts {
  readonly pagesCatalogue: unknown;
  readonly designSystem: unknown;
  readonly componentsLibrary: unknown;
}

export interface ArtifactCardsProps {
  readonly artifacts: IaArtifacts;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function countPages(v: unknown): number {
  const pages = (v as { pages?: unknown[] } | null)?.pages;
  return Array.isArray(pages) ? pages.length : 0;
}

function countComponents(v: unknown): number {
  const components = (v as { components?: unknown[] } | null)?.components;
  return Array.isArray(components) ? components.length : 0;
}

function countTokens(v: unknown): number {
  const ds = v as
    | { tokens?: { colors?: Record<string, unknown>; typography?: Record<string, unknown>; spacing?: Record<string, unknown> } }
    | null;
  if (!ds?.tokens) return 0;
  return (
    Object.keys(ds.tokens.colors ?? {}).length +
    Object.keys(ds.tokens.typography ?? {}).length +
    Object.keys(ds.tokens.spacing ?? {}).length
  );
}

export function ArtifactCards({ artifacts }: ArtifactCardsProps) {
  return (
    <Accordion>
      <AccordionItem
        value="pages-catalogue"
        title="Pages catalogue"
        defaultOpen
        badge={countPages(artifacts.pagesCatalogue) || undefined}
      >
        <pre
          data-testid="pages-catalogue-json"
          style={{
            color: '#cbd5e0',
            fontSize: 12,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {safeStringify(artifacts.pagesCatalogue)}
        </pre>
      </AccordionItem>

      <AccordionItem
        value="design-system"
        title="Design system"
        badge={countTokens(artifacts.designSystem) || undefined}
      >
        <pre
          data-testid="design-system-json"
          style={{
            color: '#cbd5e0',
            fontSize: 12,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {safeStringify(artifacts.designSystem)}
        </pre>
      </AccordionItem>

      <AccordionItem
        value="components-library"
        title="Components library"
        badge={countComponents(artifacts.componentsLibrary) || undefined}
      >
        <pre
          data-testid="components-library-json"
          style={{
            color: '#cbd5e0',
            fontSize: 12,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {safeStringify(artifacts.componentsLibrary)}
        </pre>
      </AccordionItem>
    </Accordion>
  );
}
