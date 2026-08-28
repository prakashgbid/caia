'use client';

/**
 * <DesignStagePanel> — dedicated required design stage.
 *
 * Wraps <DesignPicker> with an explainer + a Save-and-continue gate that
 * writes spec.design and advances to /wizard/build.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@caia/ui';
import { DesignPicker } from './DesignPicker';
import { StageExplainer } from './common/StageExplainer';
import { useSpec, advanceStage } from '../../lib/spec/store';
import type { DesignChoices } from '../../lib/spec/schema';
import { DocsUnlocked } from './common/DocsUnlocked';

export function DesignStagePanel(): React.JSX.Element {
  const router = useRouter();
  const [spec, mutate] = useSpec();
  const [saved, setSaved] = useState(false);

  useEffect(() => { advanceStage('design'); }, []);

  const onSaved = useCallback((choices: DesignChoices) => {
    mutate((s) => { s.design = { ...s.design, ...choices }; });
    setSaved(true);
  }, [mutate]);

  const cont = useCallback(() => router.push('/wizard/build'), [router]);

  const hasChoices = !!(spec.design?.designSystem || spec.design?.styleGuide || spec.design?.theme);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageExplainer
        title="Pick your design system, style, and theme"
        body="These choices lock in the look of every screen CAIA will build for you. You can change any of them later, but scaffolding an MVP without a design baseline produces a Frankenstein — so we require this stage."
        why="A cohesive look makes your MVP feel like a real product to investors and early users. Design decisions upfront save re-work later."
      />
      <DocsUnlocked stage="design" />
      <DesignPicker onSaved={onSaved} />
      {(saved || hasChoices) && (
        <Button onClick={cont} className="w-full h-12 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold">
          <Check className="w-4 h-4 mr-2" /> Continue to Build the MVP <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      )}
    </div>
  );
}
