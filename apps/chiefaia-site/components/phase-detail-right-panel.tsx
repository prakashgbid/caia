/**
 * PhaseDetailRightPanel — detail card for the selected microfactory /
 * control-plane component. All content is mock data from the static
 * catalog (STOL-5003: UI only, no APIs).
 */

'use client';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';
import type { FactoryItem, FactoryStage } from '../lib/mock-data';

export function PhaseDetailRightPanel({
  item,
  stage,
}: {
  item: FactoryItem;
  stage: FactoryStage;
}) {
  return (
    <Card data-testid="phase-detail">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="font-mono">
            {item.id}
          </Badge>
          <Badge variant="outline">
            {stage.code === 'CP'
              ? 'Control plane'
              : `Stage ${stage.code} — ${stage.name}`}
          </Badge>
          <Badge variant="outline">{stage.epic}</Badge>
        </div>
        <CardTitle className="text-2xl" data-testid="phase-detail-title">
          {item.name}
        </CardTitle>
        <CardDescription>{item.scope}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section aria-labelledby="phase-features-heading">
          <h3
            id="phase-features-heading"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            Features
          </h3>
          <ul className="mt-3 space-y-2">
            {item.features.map((feature) => (
              <li key={feature} className="flex gap-2 text-sm text-foreground">
                <span aria-hidden="true" className="text-muted-foreground">
                  —
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="phase-work-items-heading">
          <h3
            id="phase-work-items-heading"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            Work items
          </h3>
          <ol className="mt-3 space-y-2">
            {item.workItems.map((workItem, index) => (
              <li key={workItem} className="flex gap-3 text-sm text-foreground">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {workItem}
              </li>
            ))}
          </ol>
        </section>
        <p className="text-xs text-muted-foreground">
          Mock preview — scope, features, and work items become live pipeline
          data when project APIs ship (future story).
        </p>
      </CardContent>
    </Card>
  );
}
