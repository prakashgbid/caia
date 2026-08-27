'use client';

/**
 * <NewProjectModal> — surfaces when the founder clicks "New Project" from
 * the header. Presents Google / Apple / Email / Login later options.
 *
 * "Login later" continues anonymously (localStorage-scoped project id).
 * Login button routes to /wizard/login?next=/wizard/onboarding.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chrome, Mail, Sparkles, User, X } from 'lucide-react';
import { Button } from '@caia/ui';
import { newProject } from '../../lib/session/project';

interface Props { open: boolean; onClose: () => void; }

export function NewProjectModal({ open, onClose }: Props): React.JSX.Element | null {
  const router = useRouter();
  const [name, setName] = useState('');

  const startLoginLater = useCallback(() => {
    const p = newProject(name.trim() || 'Untitled project');
    onClose();
    router.push('/wizard/onboarding?project=' + encodeURIComponent(p.id));
  }, [name, router, onClose]);

  const startWithLogin = useCallback((provider: string) => {
    const p = newProject(name.trim() || 'Untitled project');
    onClose();
    router.push('/wizard/login?next=' + encodeURIComponent('/wizard/onboarding?project=' + p.id) + '&provider=' + provider);
  }, [name, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-brand-gradient flex items-center justify-center shadow-md shadow-primary/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="font-semibold text-lg">Start a new project</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          Log in so your work is saved automatically — or skip and continue anonymously (we&apos;ll keep it in this browser until you sign in).
        </p>

        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Project name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. NeighborChef"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={80}
          />
        </div>

        <div className="space-y-2">
          <Button onClick={() => startWithLogin('google')} className="w-full h-11 bg-white hover:bg-white/90 text-black text-sm font-semibold">
            <Chrome className="w-4 h-4 mr-2" />
            Continue with Google
          </Button>
          <Button onClick={() => startWithLogin('apple')} className="w-full h-11 bg-black hover:bg-black/85 text-white text-sm font-semibold border border-white/10">
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" /></svg>
            Continue with Apple
          </Button>
          <Button onClick={() => startWithLogin('email')} variant="outline" className="w-full h-11 text-sm font-semibold">
            <Mail className="w-4 h-4 mr-2" />
            Continue with email
          </Button>
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
          </div>
          <Button onClick={startLoginLater} variant="ghost" className="w-full h-11 text-sm">
            <User className="w-4 h-4 mr-2" />
            Login later — start anonymously
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-4 text-center leading-relaxed">
          Anonymous progress is saved in this browser only. Log in any time to sync it to your account.
        </p>
      </div>
    </div>
  );
}
