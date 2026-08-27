'use client';

/**
 * <DemoStepPreview> — brand-styled "coming soon in demo mode" card used
 * for wizard steps whose real implementation is deferred (currently:
 * Design — Stage 6). Includes a primary "Continue tour" button that
 * routes to the next step.
 */

import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Sparkles, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

export interface DemoPreviewProps {
  step: string;
  stepNumber: number;
  title: string;
  description: string;
  features: string[];
  /** Slug of the next wizard step, e.g. "atlas". */
  nextStepSlug?: string;
  /** Display label for the next-step button, e.g. "Atlas". */
  nextStep?: string;
}

export function DemoStepPreview({ step, stepNumber, title, description, features, nextStep, nextStepSlug }: DemoPreviewProps): React.JSX.Element {
  const router = useRouter();
  const goNext = () => {
    if (nextStepSlug) router.push(`/wizard/${nextStepSlug}`);
  };
  return (
    <Card
      className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5"
      data-testid={`wizard-step-${step}-demo-preview`}
    >
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step {stepNumber} · {title}
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          Coming <span className="text-brand-gradient">next in the tour</span>.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/15 text-primary border-primary/30">DEMO PREVIEW</Badge>
            <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">This step&apos;s live implementation is on the way. Here&apos;s what it will produce:</span>
          </div>
          <ul className="space-y-2.5">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/85 leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        {nextStep && nextStepSlug && (
          <div className="mt-6">
            <Button
              type="button"
              onClick={goNext}
              className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
            >
              Continue to {nextStep}
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
