'use client';
import React from 'react';
import Link from 'next/link';

export interface Domain {
  slug: string;
  name: string;
  color: string;
  icon: string;
  description?: string;
}

interface DomainChipProps {
  domain: Domain;
  /** When true, clicking the chip navigates to the domain page */
  linkable?: boolean;
  /** When provided, renders a remove button */
  onRemove?: (slug: string) => void;
  size?: 'sm' | 'md';
}

export function DomainChip({ domain, linkable = true, onRemove, size = 'sm' }: DomainChipProps) {
  const fs = size === 'sm' ? 11 : 13;
  const padding = size === 'sm' ? '2px 7px' : '4px 10px';

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding,
    borderRadius: 12,
    fontSize: fs,
    fontWeight: 500,
    background: domain.color + '22',
    color: domain.color,
    border: `1px solid ${domain.color}44`,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    cursor: linkable ? 'pointer' : 'default',
    lineHeight: 1.4,
  };

  const inner = (
    <>
      <span aria-hidden="true" style={{ fontSize: size === 'sm' ? 12 : 14 }}>{domain.icon}</span>
      <span>{domain.name}</span>
      {onRemove && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(domain.slug); }}
          style={{
            background: 'none',
            border: 'none',
            color: domain.color,
            cursor: 'pointer',
            padding: '0 1px',
            fontSize: fs,
            lineHeight: 1,
            marginLeft: 1,
            opacity: 0.7,
          }}
          aria-label={`Remove ${domain.name} domain tag`}
        >
          ×
        </button>
      )}
    </>
  );

  if (linkable) {
    return (
      <Link
        href={`/domains/${domain.slug}`}
        style={chipStyle}
        title={domain.description ?? domain.name}
        aria-label={`Domain: ${domain.name}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <span
      style={chipStyle}
      title={domain.description ?? domain.name}
      aria-label={`Domain: ${domain.name}`}
    >
      {inner}
    </span>
  );
}

interface DomainChipsRowProps {
  domains: Domain[];
  linkable?: boolean;
  onRemove?: (slug: string) => void;
  size?: 'sm' | 'md';
  label?: string;
}

export function DomainChipsRow({ domains, linkable, onRemove, size, label = 'Domains' }: DomainChipsRowProps) {
  if (!domains.length) return null;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
      aria-label={label}
      role="list"
    >
      {domains.map(d => (
        <span key={d.slug} role="listitem">
          <DomainChip domain={d} linkable={linkable} onRemove={onRemove} size={size} />
        </span>
      ))}
    </div>
  );
}
