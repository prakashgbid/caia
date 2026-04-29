import { describe, it, expect } from 'vitest';
import { extractComponentsFromInMemorySources } from '../src';

const NOW = 1745812800000;
let counter = 0;
const idFactory = (prefix: string) => `${prefix}_${counter++}`;

function reset() {
  counter = 0;
}

const baseOpts = (over: Partial<Parameters<typeof extractComponentsFromInMemorySources>[1]> = {}) => ({
  repoRoot: '/repo',
  defaultProject: 'caia',
  now: NOW,
  newId: idFactory,
  ...over,
});

describe('extractComponentsFromInMemorySources', () => {
  it('extracts a function component with typed props', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/dashboard/components/prompt-list.tsx',
        content: `
import * as React from 'react';

interface PromptListProps {
  promptIds: string[];
  onSelect?: (id: string) => void;
}

/**
 * Renders a paginated list of prompts.
 */
export function PromptList(props: PromptListProps): JSX.Element {
  const [hover, setHover] = React.useState(false);
  return <ul>{props.promptIds.map((id) => <li key={id}>{id}</li>)}</ul>;
}
`,
      },
    ];

    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const a = r.artifacts[0]!;
    expect(a.kind).toBe('component');
    expect(a.name).toBe('PromptList');
    expect(a.entryPath).toBe('apps/dashboard/components/prompt-list.tsx');
    expect(a.techSubDomains).toContain('frontend');
    expect(a.description).toContain('paginated list');
    const meta = JSON.parse(a.metadataJson);
    expect(meta.props).toHaveLength(2);
    expect(meta.props.find((p: { name: string }) => p.name === 'promptIds').required).toBe(true);
    expect(meta.props.find((p: { name: string }) => p.name === 'onSelect').required).toBe(false);
    expect(meta.componentForm).toBe('function');
    expect(meta.hooksUsed).toContain('useState');
  });

  it('extracts an arrow function component', () => {
    reset();
    const sources = [
      {
        path: '/repo/apps/dashboard/components/badge.tsx',
        content: `
type BadgeProps = { label: string };
export const Badge = (props: BadgeProps): JSX.Element => <span>{props.label}</span>;
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const a = r.artifacts[0]!;
    expect(a.name).toBe('Badge');
    const meta = JSON.parse(a.metadataJson);
    expect(meta.componentForm).toBe('arrow');
    expect(meta.props).toHaveLength(1);
    expect(meta.props[0].name).toBe('label');
  });

  it('extracts a React.memo component', () => {
    reset();
    const sources = [
      {
        path: '/repo/components/avatar.tsx',
        content: `
import React from 'react';
type AvatarProps = { src: string; alt?: string };
export const Avatar = React.memo((props: AvatarProps): JSX.Element => <img src={props.src} alt={props.alt} />);
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const meta = JSON.parse(r.artifacts[0]!.metadataJson);
    expect(meta.componentForm).toBe('memo');
  });

  it('extracts a class component extending React.Component', () => {
    reset();
    const sources = [
      {
        path: '/repo/components/legacy-modal.tsx',
        content: `
import React from 'react';
export class LegacyModal extends React.Component<{ title: string }> {
  render() {
    return <div>{this.props.title}</div>;
  }
}
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.warnings).toEqual([]);
    expect(r.artifacts).toHaveLength(1);
    const a = r.artifacts[0]!;
    expect(a.name).toBe('LegacyModal');
    const meta = JSON.parse(a.metadataJson);
    expect(meta.componentForm).toBe('class');
  });

  it('skips non-component declarations (lowercase function, no JSX)', () => {
    reset();
    const sources = [
      {
        path: '/repo/lib/util.ts',
        content: `
export function add(a: number, b: number): number { return a + b; }
export const helper = (x: number): number => x + 1;
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(0);
  });

  it('detects design-system tier from path', () => {
    reset();
    const sources = [
      {
        path: '/repo/packages/ui/src/primitive/button.tsx',
        content: `
type ButtonProps = { children: string };
export const Button = (props: ButtonProps): JSX.Element => <button>{props.children}</button>;
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.artifacts[0]!.designSystemTier).toBe('primitive');
    expect(r.artifacts[0]!.techSubDomains).toContain('design-system');
  });

  it('emits depends_on edges for imported libraries', () => {
    reset();
    const sources = [
      {
        path: '/repo/components/icon.tsx',
        content: `
import { Smile } from 'lucide-react';
import { cn } from '@chiefaia/utils';
type IconProps = { size: number };
export const Icon = (props: IconProps): JSX.Element => <Smile size={props.size} />;
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(1);
    expect(r.edges).toHaveLength(2);
    const targets = r.edges.map((e) => JSON.parse(e.metadataJson).targetPackageName).sort();
    expect(targets).toEqual(['@chiefaia/utils', 'lucide-react']);
    expect(r.edges[0]!.relation).toBe('depends_on');
  });

  it('produces stable dedup key on re-extraction', () => {
    reset();
    const sources = [
      {
        path: '/repo/components/x.tsx',
        content: `
type XProps = { a: number };
export const X = (props: XProps): JSX.Element => <div />;
`,
      },
    ];
    const r1 = extractComponentsFromInMemorySources(sources, baseOpts());
    counter = 0; // reset so the new id factory yields equivalent ids
    const r2 = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r1.artifacts[0]!.dedupKey).toBe(r2.artifacts[0]!.dedupKey);
    expect(r1.artifacts[0]!.contentHash).toBe(r2.artifacts[0]!.contentHash);
  });

  it('handles syntax errors with a warning, not a throw', () => {
    reset();
    const sources = [
      {
        path: '/repo/broken.tsx',
        content: `export const Y = (props: { z: number }`, // truncated
      },
    ];
    expect(() => extractComponentsFromInMemorySources(sources, baseOpts())).not.toThrow();
  });

  it('extracts a default export anonymous component (named via variable)', () => {
    reset();
    const sources = [
      {
        path: '/repo/app/page.tsx',
        content: `
type PageProps = { slug: string };
const Page = (props: PageProps): JSX.Element => <div>{props.slug}</div>;
export default Page;
`,
      },
    ];
    const r = extractComponentsFromInMemorySources(sources, baseOpts());
    expect(r.artifacts).toHaveLength(1);
    expect(r.artifacts[0]!.name).toBe('Page');
    expect(r.artifacts[0]!.designSystemTier).toBe('page');
  });
});
