'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { readSpec, setActiveSpecId } from '../../lib/spec/store';

const STAGE_PATH: Record<string, string> = {
  onboarding: '/wizard/onboarding', 'grand-idea': '/wizard/grand-idea',
  interview: '/wizard/interview', architecture: '/wizard/architecture',
  proposal: '/wizard/proposal', landing: '/wizard/landing',
  login: '/wizard/login', design: '/wizard/design',
  build: '/wizard/build', subscribe: '/wizard/subscribe',
};

export function ResumePanel({ projectId }: { projectId: string }): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState('Loading your project…');
  useEffect(() => {
    (async () => {
      try {
        setActiveSpecId(projectId);
        // If logged in, pull the latest from server
        try {
          const res = await fetch(`/api/wizard/project/${encodeURIComponent(projectId)}`, { credentials: 'include' });
          if (res.ok) {
            const j = await res.json() as { ok: boolean; project?: { state_json: unknown } };
            if (j.ok && j.project) {
              window.localStorage.setItem('caia.spec.' + projectId, JSON.stringify(j.project.state_json));
            }
          }
        } catch { /* offline — use local */ }
        const spec = readSpec(projectId);
        const stage = spec.currentStage || 'onboarding';
        const path = STAGE_PATH[stage] || '/wizard/onboarding';
        setStatus(`Resuming at ${stage}…`);
        router.replace(path);
      } catch (e) {
        setStatus('Could not resume: ' + (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return (
    <div className="max-w-md mx-auto text-center py-16 space-y-3">
      <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
      <p className="text-sm text-muted-foreground">{status}</p>
    </div>
  );
}
