/**
 * `<SelectionBreadcrumb>` — root→leaf path of the current selection.
 *
 * Each segment is a focusable button per spec §3.3. Clicking a
 * segment dispatches `onSelect(ticketId)` which the host wires to
 * `useAtlasSelection.selectTicket`.
 */

import * as React from 'react';
import { memo } from 'react';

export interface BreadcrumbSegment {
  id: string;
  level: string;
  title: string;
}

export interface SelectionBreadcrumbProps {
  segments: BreadcrumbSegment[];
  onSelect?: (ticketId: string) => void;
  /** Optional aria-label override for the breadcrumb nav. */
  ariaLabel?: string;
}

function SelectionBreadcrumbImpl(props: SelectionBreadcrumbProps): React.ReactElement {
  const { segments, onSelect } = props;
  const ariaLabel = props.ariaLabel ?? 'Selection path';

  if (segments.length === 0) {
    return (
      <nav className="atlas-breadcrumb" aria-label={ariaLabel} data-testid="atlas-breadcrumb">
        <span className="atlas-breadcrumb__separator">No selection</span>
      </nav>
    );
  }

  return (
    <nav className="atlas-breadcrumb" aria-label={ariaLabel} data-testid="atlas-breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={seg.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="atlas-breadcrumb__item"
              aria-current={isLast ? 'true' : undefined}
              onClick={() => onSelect?.(seg.id)}
              data-ticket-id={seg.id}
              title={`${seg.level} · ${seg.id}`}
            >
              {seg.title}
            </button>
            {!isLast ? <span aria-hidden="true" className="atlas-breadcrumb__separator">›</span> : null}
          </span>
        );
      })}
    </nav>
  );
}

export const SelectionBreadcrumb = memo(SelectionBreadcrumbImpl);
SelectionBreadcrumb.displayName = 'SelectionBreadcrumb';
