'use client';

/**
 * <SubscribePanel> — Stage 9. Payment gate or download stub.
 *
 * Per operator: $9.99/mo or $59.99/yr (~50% off equiv). Alt path = download
 * project so far. Payment is MOCK — no Stripe wiring yet; button just
 * confetti's + "Thanks!". [[deferred-post-launch]] is in effect.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, Coins, Download, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

export function SubscribePanel(): React.JSX.Element {
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [confirmed, setConfirmed] = useState<null | 'paid' | 'downloaded'>(null);
  const [busy, setBusy] = useState(false);

  const confirmPaid = useCallback(() => {
    setBusy(true);
    setTimeout(() => { setConfirmed('paid'); setBusy(false); }, 900);
  }, []);

  const download = useCallback(() => {
    setBusy(true);
    // Stub: build a placeholder zip contents string and offer as download
    const content = 'CAIA MVP export — placeholder\n\nYour generated screens will be bundled here in the shipped build.\n';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'caia-mvp.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setTimeout(() => { setConfirmed('downloaded'); setBusy(false); }, 600);
  }, []);

  if (confirmed) {
    return (
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5 max-w-xl mx-auto text-center">
        <CardHeader>
          <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-lg shadow-primary/30 mb-3">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-2xl">
            {confirmed === 'paid' ? 'You’re in.' : 'Downloaded.'}
          </CardTitle>
          <CardDescription className="text-base">
            {confirmed === 'paid'
              ? 'Your CAIA workspace is being provisioned. We’ll email you when it’s ready to ship.'
              : 'Your MVP-so-far export is on its way. Come back when you’re ready to build the full thing.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
        <CardHeader className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mx-auto">
            <Sparkles className="w-3 h-3" />
            Step 9 · Ship it
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">
            One step from a real, running app.
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            Pick a plan and CAIA will spin up your workspace, wire the code you just built, and hand you a live URL. Change your mind? Take the project file with you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setPlan('monthly')}
              className={`text-left rounded-2xl border p-5 transition-all ${plan === 'monthly' ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border/60 hover:border-border'}`}
            >
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monthly</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">$9.99</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">Cancel anytime.</div>
            </button>
            <button
              type="button"
              onClick={() => setPlan('yearly')}
              className={`text-left rounded-2xl border p-5 relative transition-all ${plan === 'yearly' ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border/60 hover:border-border'}`}
            >
              <div className="absolute -top-2 right-4 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-gradient text-white">
                50% off
              </div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Yearly</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">$59.99</span>
                <span className="text-muted-foreground">/yr</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">Works out to $5/mo. Best deal.</div>
            </button>
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground space-y-1.5">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Everything you generated stays yours.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Deployed to a live URL under caia.app or your own domain.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> Bring your own AI key (free) or use ours (metered).</div>
            <div className="flex items-center gap-2"><Coins className="w-4 h-4 text-primary" /> 1,000 build tokens included every month.</div>
          </div>

          <Button
            onClick={confirmPaid}
            disabled={busy}
            className="w-full h-14 bg-brand-gradient hover:opacity-90 text-white glow-brand text-base font-semibold"
          >
            {busy ? 'Working…' : plan === 'yearly' ? 'Start yearly — $59.99' : 'Start monthly — $9.99'}
          </Button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
          </div>

          <Button
            onClick={download}
            variant="outline"
            disabled={busy}
            className="w-full h-12 text-sm font-semibold"
          >
            <Download className="w-4 h-4 mr-2" />
            Download the project I built so far
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
