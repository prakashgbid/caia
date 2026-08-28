'use client';

/**
 * <WizardShell> — the app frame for every /wizard/* page.
 *
 * Layout:
 *   [ Header — logo · progress% · theme toggle · save-exit ]
 *   [ Sidebar (steps) | Main content ]
 *   [ Footer — copyright · links · brand tagline ]
 *
 * The sidebar stepper renders 7 vertical items with 3 visual states:
 *   ✓ done  (green check circle)
 *   ● current (indigo-violet gradient circle)
 *   ○ pending (muted hollow circle)
 *
 * Content children are wrapped in a fade-in-up animation on route change
 * for a polished feel.
 *
 * Reuse-first: primitives from @caia/ui only. Icons from lucide-react.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, LogOut, MoonStar, Sparkles, Sun } from 'lucide-react';
import { WIZARD_STEPS } from '../../lib/wizard/steps';
import { TokenBadge } from '../session/TokenBadge';
import { DocsFolder } from '../session/DocsFolder';
import { LoginPill } from '../session/LoginPill';
import { NewProjectModal } from '../session/NewProjectModal';
import { Plus } from 'lucide-react';

interface WizardShellProps {
  children: React.ReactNode;
}

export function WizardShell({ children }: WizardShellProps): React.JSX.Element {
  const pathname = usePathname() ?? '';
  const match = /^\/wizard\/([^/]+)/.exec(pathname);
  const activeSlug = match?.[1];
  const activeIndex = WIZARD_STEPS.find((s) => s.slug === activeSlug)?.index ?? 1;
  const progressPct = Math.round((activeIndex / WIZARD_STEPS.length) * 100);
  const activeStep = WIZARD_STEPS[activeIndex - 1];

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // Theme toggle (persists to localStorage; defaults to dark)
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('caia-theme') : null;
    const dark = stored ? stored === 'dark' : true;
    setIsDark(dark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', dark);
    }
  }, []);
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next);
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('caia-theme', next ? 'dark' : 'light');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-brand-gradient flex items-center justify-center glow-brand">
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-foreground text-sm tracking-tight group-hover:text-primary transition-colors">
              CAIA
              <span className="text-muted-foreground font-normal ml-1">Wizard</span>
            </span>
          </Link>

          {/* Progress in header */}
          <div className="hidden md:flex items-center gap-3 flex-1 max-w-md mx-8">
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">
              Step {activeIndex} of {WIZARD_STEPS.length}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-gradient transition-all duration-500 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{progressPct}%</span>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setNewProjectOpen(true)} className="hidden md:inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2 h-8 rounded-md hover:bg-primary/5 transition-colors font-medium" title="Start a new project">
              <Plus className="w-3.5 h-3.5" /> New project
            </button>
            <Link href="/wizard/roadmap" className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 h-8 rounded-md hover:bg-muted transition-colors" title="The full CAIA factory roadmap">
              Roadmap
            </Link>
            <DocsFolder />
            <TokenBadge />
            <LoginPill />
            <button
              type="button"
              onClick={toggleTheme}
              className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <MoonStar className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  // Import project store lazily to avoid SSR
                  const store = await import('../../lib/session/project');
                  await store.syncToBackend();
                  const activeId = typeof window !== 'undefined' ? (window.localStorage.getItem('caia.activeSpecId') || 'anon') : 'anon';
                  const url = `${window.location.origin}/wizard/resume?p=${encodeURIComponent(activeId)}`;
                  try { await navigator.clipboard.writeText(url); } catch { /* no clipboard */ }
                  alert('Your work is saved. Resume link copied to clipboard:\n' + url);
                  window.location.href = 'https://chiefaia.com';
                } catch (e) {
                  alert('Save failed: ' + (e as Error).message);
                }
              }}
              className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 h-8 rounded-md hover:bg-muted transition-colors"
              title="Save & exit — your work is saved + resume link copied to clipboard"
            >
              <LogOut className="w-3.5 h-3.5" />
              Save & exit
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-6 gap-6 lg:gap-8">
        {/* Sidebar stepper */}
        <aside className="hidden lg:block w-64 shrink-0">
          <nav className="sticky top-20 space-y-1">
            <div className="mb-3 px-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your CAIA journey
              </p>
              {activeStep && (
                <p className="mt-1 text-xs text-muted-foreground/80 leading-relaxed">
                  {activeStep.description}
                </p>
              )}
            </div>
            {WIZARD_STEPS.map((step) => {
              const isActive = step.index === activeIndex;
              const isDone = step.index < activeIndex;
              const isPending = step.index > activeIndex;
              return (
                <Link
                  key={step.slug}
                  href={`/wizard/${step.slug}`}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    isActive
                      ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
                      : isDone
                        ? 'text-foreground/80 hover:bg-muted'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span className="shrink-0 w-5 h-5 flex items-center justify-center">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : isActive ? (
                      <span className="w-5 h-5 rounded-full bg-brand-gradient flex items-center justify-center text-[10px] font-bold text-white glow-brand">
                        {step.index}
                      </span>
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground/40" strokeWidth={1.5} />
                    )}
                  </span>
                  <span className={`truncate ${isActive ? 'font-semibold' : ''}`}>{step.title}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Mobile progress pill */}
        <div className="lg:hidden fixed top-14 left-0 right-0 z-30 border-b border-border/50 bg-background/85 backdrop-blur-md px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">Step {activeIndex}</span>
            <span className="text-muted-foreground truncate">· {activeStep?.title}</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden ml-auto max-w-24">
              <div
                className="h-full bg-brand-gradient transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 lg:pt-0 pt-10">
          <div key={pathname} className="animate-fade-in-up">
            {children}
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-background/50 mt-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} ChiefAIA · Building software with AI, together.</p>
          <div className="flex items-center gap-4">
            <a href="https://chiefaia.com/legal/terms" className="hover:text-foreground transition-colors">Terms</a>
            <a href="https://chiefaia.com/legal/privacy" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="https://chiefaia.com/docs" className="hover:text-foreground transition-colors">Docs</a>
            <a href="https://chiefaia.com/factory" className="hover:text-foreground transition-colors">Status</a>
          </div>
        </div>
      </footer>
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}
