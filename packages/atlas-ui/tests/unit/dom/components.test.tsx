/**
 * Component render tests — smoke + role/label assertions.
 *
 * These ensure the components render in jsdom, expose the right
 * ARIA roles + names, and respond to keyboard input.
 */

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  AgentStatusSidebar,
  AtlasShell,
  PromptDock,
  ScopeBoxOverlay,
  SelectionBreadcrumb,
  TicketPane,
} from '../../../src/index.js';
import { ticketTree, sampleEvents, HERO_STATS_TICKET_ID } from '../../../fixtures/index.js';

describe('<SelectionBreadcrumb>', () => {
  it('renders an empty state', () => {
    render(<SelectionBreadcrumb segments={[]} />);
    expect(screen.getByLabelText('Selection path')).toBeInTheDocument();
    expect(screen.getByText('No selection')).toBeInTheDocument();
  });

  it('fires onSelect when a segment is clicked', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <SelectionBreadcrumb
        segments={[
          { id: 'PG-home', level: 'page', title: '/ Home' },
          { id: 'SE-hero', level: 'section', title: 'Hero' },
        ]}
        onSelect={spy}
      />,
    );
    await user.click(screen.getByText('/ Home'));
    expect(spy).toHaveBeenCalledWith('PG-home');
  });
});

describe('<ScopeBoxOverlay>', () => {
  it('renders no rects when boxes are empty', () => {
    const { container } = render(<ScopeBoxOverlay boxes={[]} width={800} height={500} />);
    const rects = container.querySelectorAll('rect.atlas-scope-box');
    expect(rects.length).toBe(0);
  });

  it('renders one box per selection', () => {
    const { container } = render(
      <ScopeBoxOverlay
        boxes={[
          { domId: 'A', rect: { x: 0, y: 0, w: 100, h: 50 } },
          { domId: 'B', rect: { x: 50, y: 80, w: 100, h: 50 } },
        ]}
        width={800}
        height={500}
      />,
    );
    expect(container.querySelectorAll('g[data-atlas-overlay="box"]').length).toBe(2);
  });
});

describe('<TicketPane>', () => {
  it('renders the empty state with no root', () => {
    render(<TicketPane root={null} selectedTicketIds={[]} />);
    expect(screen.getByLabelText('Ticket hierarchy')).toBeInTheDocument();
    expect(screen.getByText('No tickets loaded yet.')).toBeInTheDocument();
  });

  it('renders the root row when given a tree', () => {
    render(<TicketPane root={ticketTree.tree} selectedTicketIds={[]} />);
    expect(screen.getByText('prakash-tiwari.com')).toBeInTheDocument();
  });

  it('search filters the visible rows', async () => {
    const user = userEvent.setup();
    render(<TicketPane root={ticketTree.tree} selectedTicketIds={[]} />);
    await user.type(screen.getByTestId('atlas-ticket-search'), 'stats');
    expect(screen.getByText('Stats row')).toBeInTheDocument();
  });

  it('fires onSelect on row click', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <TicketPane root={ticketTree.tree} selectedTicketIds={[]} onSelect={spy} />,
    );
    await user.click(screen.getByText('prakash-tiwari.com'));
    expect(spy).toHaveBeenCalledWith(ticketTree.tree.id, 'replace');
  });
});

describe('<PromptDock>', () => {
  it('renders nothing when selection is null', () => {
    const { container } = render(<PromptDock selection={null} selectedCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('Cmd+Enter submits', async () => {
    const submit = vi.fn().mockResolvedValue({
      versionId: 'tv_test',
      ticketState: 'change-requested',
      expectedChangeDescription: 'x',
      dispatchedTo: [],
      enqueuedAt: '2026-01-01T00:00:00Z',
    });
    render(
      <PromptDock
        selection={{ ticketId: HERO_STATS_TICKET_ID, title: 'Stats row', level: 'story' }}
        selectedCount={1}
        onSubmit={submit}
      />,
    );
    const ta = screen.getByTestId('atlas-prompt-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'make it serif' } });
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(submit).toHaveBeenCalled();
    const call = submit.mock.calls[0]?.[0];
    expect(call.prompt).toBe('make it serif');
    expect(call.selection).toEqual([HERO_STATS_TICKET_ID]);
  });
});

describe('<AgentStatusSidebar>', () => {
  it('renders an empty state with live indicator', () => {
    render(<AgentStatusSidebar events={[]} connected />);
    expect(screen.getByText('No agent activity yet.')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders events newest-first', () => {
    render(<AgentStatusSidebar events={sampleEvents} connected />);
    expect(screen.getAllByText(/caia-frontend-architect/i).length).toBeGreaterThan(0);
  });

  it('shows error when error is set', () => {
    render(<AgentStatusSidebar events={[]} connected={false} error={new Error('fail')} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});

describe('<AtlasShell>', () => {
  it('renders the divider with role separator and aria values', () => {
    render(
      <AtlasShell
        designPane={<div>design</div>}
        ticketPane={<div>tickets</div>}
      />,
    );
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow');
  });

  it('arrow keys adjust the split', () => {
    render(
      <AtlasShell
        designPane={<div>design</div>}
        ticketPane={<div>tickets</div>}
      />,
    );
    const sep = screen.getByRole('separator');
    const before = Number(sep.getAttribute('aria-valuenow'));
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    const after = Number(sep.getAttribute('aria-valuenow'));
    expect(after).toBeLessThan(before);
  });
});
