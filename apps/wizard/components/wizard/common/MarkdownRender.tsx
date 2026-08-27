'use client';

/**
 * <MarkdownRender> — minimal markdown → JSX renderer with safe inline handling.
 *
 * Handles: H1-H6, paragraphs, bold, italic, code spans, fenced code blocks,
 * ordered/unordered lists, blockquotes, hr, links. Good enough for the LLM
 * markdown we emit. Upgrade to react-markdown later if we need tables/etc.
 */

import React from 'react';

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // Split by code spans first (they are literal)
  const parts = text.split(/(`[^`]+`)/g);
  const out: React.ReactNode[] = [];
  parts.forEach((seg, i) => {
    const key = `${keyBase}-${i}`;
    if (/^`[^`]+`$/.test(seg)) {
      out.push(
        <code key={key} className="px-1 py-0.5 rounded bg-muted text-xs">
          {seg.slice(1, -1)}
        </code>,
      );
      return;
    }
    // Now walk the string handling **bold**, *italic*, [link](url)
    let rest = seg;
    let subI = 0;
    while (rest.length > 0) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
      const boldMatch = /\*\*([^*]+)\*\*/.exec(rest);
      const italicMatch = /(^|[^*])\*([^*]+)\*/.exec(rest);
      const candidates: Array<{ idx: number; end: number; node: React.ReactNode }> = [];
      if (linkMatch) candidates.push({ idx: linkMatch.index, end: linkMatch.index + linkMatch[0].length,
        node: <a key={`${key}l${subI++}`} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-primary underline">{linkMatch[1]}</a> });
      if (boldMatch) candidates.push({ idx: boldMatch.index, end: boldMatch.index + boldMatch[0].length,
        node: <strong key={`${key}b${subI++}`}>{boldMatch[1]}</strong> });
      if (italicMatch) {
        const offset = italicMatch[1].length;
        candidates.push({ idx: italicMatch.index + offset, end: italicMatch.index + italicMatch[0].length,
          node: <em key={`${key}i${subI++}`}>{italicMatch[2]}</em> });
      }
      if (candidates.length === 0) { out.push(rest); break; }
      candidates.sort((a, b) => a.idx - b.idx);
      const first = candidates[0];
      if (first.idx > 0) out.push(rest.slice(0, first.idx));
      out.push(first.node);
      rest = rest.slice(first.end);
    }
  });
  return out;
}

export function MarkdownRender({ source }: { source: string }): React.JSX.Element {
  const lines = source.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const ln = lines[i];
    // Fenced code
    if (/^```/.test(ln)) {
      const lang = ln.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(
        <pre key={key++} className="rounded-lg bg-muted/70 p-3 text-xs overflow-x-auto my-3">
          <code>{buf.join('\n')}</code>
          {lang && <div className="text-[10px] text-muted-foreground mt-1">{lang}</div>}
        </pre>,
      );
      continue;
    }
    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) {
      const lvl = h[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const cls = [
        'text-3xl font-bold mt-6 mb-3',
        'text-2xl font-semibold mt-5 mb-2.5',
        'text-xl font-semibold mt-4 mb-2',
        'text-lg font-semibold mt-3 mb-1.5',
        'text-base font-semibold mt-2 mb-1',
        'text-sm font-semibold mt-2 mb-1',
      ][lvl - 1];
      const Tag = `h${lvl}` as keyof React.JSX.IntrinsicElements;
      out.push(React.createElement(Tag, { key: key++, className: cls }, renderInline(h[2], `h${key}`)));
      i++;
      continue;
    }
    if (/^---\s*$/.test(ln)) { out.push(<hr key={key++} className="my-4 border-border/50" />); i++; continue; }
    if (/^>\s?/.test(ln)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(
        <blockquote key={key++} className="border-l-4 border-primary/40 pl-3 my-3 text-muted-foreground italic">
          {renderInline(buf.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }
    if (/^\d+\.\s/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, '')); i++; }
      out.push(
        <ol key={key++} className="list-decimal pl-6 my-2 space-y-1">
          {items.map((t, j) => <li key={j}>{renderInline(t, `o${key}${j}`)}</li>)}
        </ol>,
      );
      continue;
    }
    if (/^[-*+]\s/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s/, '')); i++; }
      out.push(
        <ul key={key++} className="list-disc pl-6 my-2 space-y-1">
          {items.map((t, j) => <li key={j}>{renderInline(t, `u${key}${j}`)}</li>)}
        </ul>,
      );
      continue;
    }
    if (/^\s*$/.test(ln)) { i++; continue; }
    const buf: string[] = [ln];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s|---)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(<p key={key++} className="my-2 leading-relaxed">{renderInline(buf.join(' '), `p${key}`)}</p>);
  }

  return <div>{out}</div>;
}
