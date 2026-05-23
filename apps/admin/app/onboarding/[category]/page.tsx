import { notFound, redirect } from 'next/navigation';
import { getCategory } from '@caia/onboarding';
import { Wizard } from '../../../components/Wizard';
import { getEngine } from '../../../lib/engine';

interface PageProps {
  params: Promise<{ category: string }>;
}

export default async function OnboardingCategoryPage({ params }: PageProps) {
  const { category } = await params;
  const def = getCategory(category);
  if (!def) notFound();

  const { engine, store } = getEngine();
  let tenant = await store.getTenant('dev-tenant');
  if (!tenant) {
    tenant = await store.createTenant({
      id: 'dev-tenant',
      slug: 'dev',
      name: 'Dev Tenant',
      ownerEmail: 'dev@caia.local',
      billingEmail: 'dev@caia.local',
      timezone: 'UTC',
      locale: 'en-US',
    });
  }
  const state = await engine.stateFor(tenant.id);

  if (state.ready && def.required) {
    redirect('/onboarding/complete');
  }

  return (
    <Wizard
      tenantId={tenant.id}
      category={def}
      initialState={{
        tenantId: state.tenantId,
        currentId: state.current?.id,
        ready: state.ready,
        steps: state.steps.map((s) => {
          const o: {
            category: { id: string; label: string; ordinal: number; required: boolean };
            status: typeof s.status;
            attemptCount: number;
            failureReason?: string;
          } = {
            category: {
              id: s.category.id,
              label: s.category.label,
              ordinal: s.category.ordinal,
              required: s.category.required,
            },
            status: s.status,
            attemptCount: s.attemptCount,
          };
          if (s.failureReason) o.failureReason = s.failureReason;
          return o;
        }),
      }}
    />
  );
}
