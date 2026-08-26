'use client';

/**
 * Wizard Step 7 — Atlas.
 *
 * The final tour step. Currently a warm DEMO PREVIEW with a big
 * "Finish tour → Factory Live" CTA that routes to chiefaia.com/factory.
 */

import { ArrowRight, CheckCircle2, Rocket, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

export default function AtlasPage(): React.JSX.Element {
  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 7 · Atlas
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          The <span className="text-brand-gradient">last piece</span> — your ticket tree.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          CAIA turns the Grand Idea, IA, and Design into an implementation-ready backlog with per-ticket prompts. Everything traces back to a design decision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/15 text-primary border-primary/30">DEMO PREVIEW</Badge>
            <span className="text-xs text-muted-foreground">In production this stage produces:</span>
          </div>
          <ul className="space-y-2.5">
            {[
              'Ticket tree — Epic → Story → Task hierarchy in Jira or Linear',
              'Design-id → ticket mapping so every ticket links back to a wireframe',
              'Cursor / Copilot-ready implementation prompts per ticket',
              'Full traceability: Grand Idea → IA → Proposal → Design → Atlas ticket',
            ].map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/85 leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button
            type="button"
            onClick={() => { window.location.href = 'https://chiefaia.com/factory'; }}
            data-testid="atlas-finish-tour"
            className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
          >
            <Rocket className="w-4 h-4 mr-1.5" />
            Finish tour → Factory Live
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
          <p className="text-xs text-muted-foreground">
            You&apos;ve walked the whole 7-step tour. Factory Live shows what CAIA is producing right now.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
