/**
 * `<AtlasShell>` stories — full split-screen composition driven by
 * mock fixtures. The "Default" story is what Playwright e2e runs against.
 */

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMapper, buildDomIdMap, assignStableDomIds } from '@chiefaia/atlas-mapper';

import {
  AgentStatusSidebar,
  AtlasShell,
  DesignPane,
  PromptDock,
  SelectionBreadcrumb,
  TicketPane,
  createMockClient,
  useAtlasSelection,
  useAtlasSse,
  type AtlasSseEvent,
  type AtlasSubmitPromptRequest,
  type AtlasSubmitPromptResponse,
} from '../src/index.js';
import {
  HERO_STATS_TICKET_ID,
  PROJECT_ID,
  buildFixtureDataUrl,
  latestDesign,
  renderableDesign,
  sampleEvents,
  ticketTree,
  toMapperTickets,
  versionsByTicketId,
} from '../fixtures/index.js';

const meta: Meta<typeof AtlasShell> = {
  title: 'AtlasShell',
  component: AtlasShell,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof AtlasShell>;

interface HarnessProps {
  initialSelectionTicketId?: string;
  withSidebar?: boolean;
  preCannedEvents?: AtlasSseEvent[];
  onSubmitSpy?: (body: AtlasSubmitPromptRequest, res: AtlasSubmitPromptResponse) => void;
}

function Harness(props: HarnessProps): React.ReactElement {
  const client = useMemo(
    () =>
      createMockClient({
        latestDesign: { projectId: PROJECT_ID, designVersion: latestDesign },
        ticketsTree: ticketTree,
        versionsByTicketId,
        events: props.preCannedEvents ?? [],
      }),
    [props.preCannedEvents],
  );
  const mapper = useMemo(() => {
    const stabilised = assignStableDomIds(renderableDesign);
    const domMap = buildDomIdMap(stabilised);
    return buildMapper(domMap, toMapperTickets(ticketTree.tree));
  }, []);
  const selection = useAtlasSelection(mapper);
  const sse = useAtlasSse({ projectId: PROJECT_ID, client });
  const [iframeUrl, setIframeUrl] = useState(latestDesign.iframeUrl);
  useEffect(() => {
    if (typeof window !== 'undefined') setIframeUrl(buildFixtureDataUrl());
  }, []);
  const design = { ...latestDesign, iframeUrl };

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!props.initialSelectionTicketId) return;
    seededRef.current = true;
    selection.selectTicket(props.initialSelectionTicketId);
  }, [props.initialSelectionTicketId, selection]);

  const ticketLabels = useMemo(() => {
    const m = new Map<string, string>();
    function walk(n: typeof ticketTree.tree): void {
      if (n.domId) m.set(n.domId, `${n.level}: ${n.title}`);
      if (n.children) for (const c of n.children) walk(c);
    }
    walk(ticketTree.tree);
    return m;
  }, []);

  const liveStateOverrides = useMemo(() => {
    const m = new Map<string, import('../src/index.js').TicketState>();
    for (const e of sse.events) {
      if (e.type === 'ticket.state-changed') m.set(e.ticketId, e.to);
      if (e.type === 'agent.run-started') m.set(e.ticketId, 'in-progress');
      if (e.type === 'agent.run-finished')
        m.set(e.ticketId, e.result === 'ok' ? 'implemented' : 'failed');
    }
    return m;
  }, [sse.events]);

  const primaryTicket = selection.selection.primary
    ? (() => {
        const last = selection.breadcrumb[selection.breadcrumb.length - 1];
        if (!last) return null;
        return { ticketId: last.id, title: last.title, level: last.level };
      })()
    : null;

  const handleSubmit = async (body: AtlasSubmitPromptRequest): Promise<AtlasSubmitPromptResponse> => {
    const res = await client.submitPrompt(body.selection[0]!, body);
    props.onSubmitSpy?.(body, res);
    return res;
  };

  const liveRegionMessage = selection.selection.primary
    ? `Selected ${selection.selection.primary.ticketId}`
    : '';

  return (
    <AtlasShell
      designPane={
        <DesignPane
          design={design}
          selection={selection.selection}
          onClick={(domId, mods) =>
            selection.selectDomId(
              domId,
              mods?.shift ? 'add' : mods?.meta || mods?.ctrl ? 'toggle' : 'replace',
            )
          }
          ticketLabels={ticketLabels}
        />
      }
      ticketPane={
        <TicketPane
          root={ticketTree.tree}
          selectedTicketIds={selection.selection.ticketIds}
          onSelect={(id, mode) => selection.selectTicket(id, mode)}
          liveStateOverrides={liveStateOverrides}
        />
      }
      breadcrumb={
        <SelectionBreadcrumb
          segments={selection.breadcrumb}
          onSelect={(id) => selection.selectTicket(id)}
        />
      }
      promptDock={
        primaryTicket ? (
          <PromptDock
            selection={primaryTicket}
            selectedCount={selection.selection.ticketIds.length}
            onSubmit={handleSubmit}
            onClose={() => selection.clear()}
            history={
              selection.selection.primary
                ? versionsByTicketId[selection.selection.primary.ticketId]?.versions ?? []
                : []
            }
          />
        ) : null
      }
      agentSidebar={
        props.withSidebar ? (
          <AgentStatusSidebar events={sse.events} connected={sse.connected} error={sse.error} />
        ) : null
      }
      liveRegionMessage={liveRegionMessage}
      recentEvents={sse.events}
    />
  );
}

export const Default: Story = { render: () => <Harness /> };
export const WithSelection: Story = { render: () => <Harness initialSelectionTicketId="SE-home-hero" /> };
export const WithDeepSelection: Story = {
  render: () => <Harness initialSelectionTicketId={HERO_STATS_TICKET_ID} />,
};
export const WithSidebar: Story = { render: () => <Harness withSidebar preCannedEvents={sampleEvents} /> };
export const WithLiveSseEvents: Story = {
  render: () => (
    <Harness withSidebar initialSelectionTicketId={HERO_STATS_TICKET_ID} preCannedEvents={sampleEvents} />
  ),
};
