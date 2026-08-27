'use client';

/**
 * <DesignPicker> — asks the founder to pick design system + style guide + theme.
 *
 * Persisted into project.design. Preselects sensible defaults so a founder
 * who just wants to move on can hit Next with a single click.
 */

import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@caia/ui';
import { readProject, updateProject, type DesignChoices } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';

const SYSTEMS: Array<{ key: DesignChoices['designSystem']; name: string; desc: string }> = [
  { key: 'shadcn', name: 'shadcn/ui', desc: 'Modern, clean, developer-favoured. Best for SaaS.' },
  { key: 'mui', name: 'Material UI', desc: 'Google Material. Enterprise-friendly, high familiarity.' },
  { key: 'chakra', name: 'Chakra UI', desc: 'Accessible-by-default, warm, approachable.' },
  { key: 'ant', name: 'Ant Design', desc: 'Dense info-rich components. Best for admin dashboards.' },
  { key: 'custom', name: 'Custom / minimal', desc: 'No framework — hand-crafted look.' },
];
const STYLES: Array<{ key: DesignChoices['styleGuide']; name: string; desc: string }> = [
  { key: 'minimal', name: 'Minimal', desc: 'Lots of whitespace, restrained color.' },
  { key: 'warm', name: 'Warm', desc: 'Friendly, rounded, human.' },
  { key: 'corporate', name: 'Corporate', desc: 'Trusted, professional, muted.' },
  { key: 'playful', name: 'Playful', desc: 'Bright, illustrated, energetic.' },
  { key: 'editorial', name: 'Editorial', desc: 'Serif-forward, magazine feel.' },
  { key: 'brutalist', name: 'Brutalist', desc: 'Raw, bold, unpretty on purpose.' },
];
const THEMES: Array<{ key: DesignChoices['theme']; name: string }> = [
  { key: 'light', name: 'Light' },
  { key: 'dark', name: 'Dark' },
  { key: 'auto', name: 'Auto (system)' },
];

interface Props { onSaved?: (choices: DesignChoices) => void; }

export function DesignPicker({ onSaved }: Props): React.JSX.Element {
  const [c, setC] = useState<DesignChoices>({});
  useEffect(() => { setC(readProject().design); }, []);

  const save = () => {
    const merged: DesignChoices = { designSystem: 'shadcn', styleGuide: 'minimal', theme: 'auto', ...c };
    updateProject((p) => { p.design = merged; });
    onSaved?.(merged);
  };

  return (
    <div className="space-y-4">
      <StageExplainer
        title="Pick your design system, style, and theme"
        body="These three choices shape how every screen CAIA builds will look. Change your mind later — nothing is locked in."
        why="Design decisions early save re-work later. A cohesive look also makes your MVP feel like a real product to investors and early users."
      />

      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Design system</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {SYSTEMS.map((sys) => {
            const active = c.designSystem === sys.key;
            return (
              <button key={sys.key} type="button" onClick={() => setC({ ...c, designSystem: sys.key })}
                className={`text-left rounded-lg border p-3 transition-all ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/60 hover:border-border'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{sys.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-primary ml-auto" />}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{sys.desc}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Style guide</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STYLES.map((st) => {
            const active = c.styleGuide === st.key;
            return (
              <button key={st.key} type="button" onClick={() => setC({ ...c, styleGuide: st.key })}
                className={`text-left rounded-lg border p-3 transition-all ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/60 hover:border-border'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{st.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-primary ml-auto" />}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{st.desc}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Theme</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          {THEMES.map((t) => {
            const active = c.theme === t.key;
            return (
              <button key={t.key} type="button" onClick={() => setC({ ...c, theme: t.key })}
                className={`px-4 py-2 rounded-lg border text-sm transition-all ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/60 hover:border-border'}`}>
                {t.name}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Button onClick={save} className="w-full h-12 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
        <Sparkles className="w-4 h-4 mr-2" /> Save my design choices
      </Button>
    </div>
  );
}
