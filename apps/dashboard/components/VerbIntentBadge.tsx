
export type VerbIntent = 'fix' | 'refactor' | 'extract' | 'audit' | 'spike' | 'multi' | 'chore' | 'add';

const VERB_COLORS: Record<VerbIntent, { bg: string; text: string }> = {
  fix:      { bg: '#742a2a', text: '#fc8181' },
  refactor: { bg: '#7b341e', text: '#fbd38d' },
  extract:  { bg: '#744210', text: '#faf089' },
  audit:    { bg: '#2a4365', text: '#90cdf4' },
  spike:    { bg: '#1d4044', text: '#4fd1c5' },
  multi:    { bg: '#44337a', text: '#d6bcfa' },
  chore:    { bg: '#2d3748', text: '#a0aec0' },
  add:      { bg: '#22543d', text: '#9ae6b4' },
};

const VERB_LABELS: Record<VerbIntent, string> = {
  fix:      '🔧 fix',
  refactor: '♻ refactor',
  extract:  '↗ extract',
  audit:    '🔍 audit',
  spike:    '⚡ spike',
  multi:    '🤝 multi',
  chore:    '⚙ chore',
  add:      '✚ add',
};

interface VerbIntentBadgeProps {
  intent: VerbIntent;
  size?: 'sm' | 'md';
}

export function VerbIntentBadge({ intent, size = 'sm' }: VerbIntentBadgeProps) {
  const colors = VERB_COLORS[intent] ?? { bg: '#2d3748', text: '#e2e8f0' };
  const fontSize = size === 'md' ? '12px' : '10px';
  const padding = size === 'md' ? '3px 8px' : '2px 6px';

  return (
    <span style={{
      background: colors.bg,
      color: colors.text,
      fontSize,
      padding,
      borderRadius: '4px',
      fontWeight: '600',
      fontFamily: 'monospace',
      letterSpacing: '0.02em',
      border: `1px solid ${colors.text}33`,
      whiteSpace: 'nowrap' as const,
    }}>
      {VERB_LABELS[intent] ?? intent}
    </span>
  );
}

export function isVerbIntent(v: unknown): v is VerbIntent {
  return typeof v === 'string' && v in VERB_COLORS;
}
