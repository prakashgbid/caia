# @pokerzeno/cast-bridge

Cast your game to the TV — zero fees, no backend, no Google registration.

## How it works

```
Personal device (/play)          Same device (new tab /cast/<roomId>)      TV
┌─────────────────────┐          ┌──────────────────────────────────┐
│  Full game view     │          │  Public view (no hole cards)     │
│  Hole cards visible │──BC──▶  │  Community cards, stacks, pot    │──Chrome Cast──▶ 📺
│  Balance visible    │  API     │  Action history                  │
│  Coach output       │          │  No private data                 │
└─────────────────────┘          └──────────────────────────────────┘
```

- **BroadcastChannel API** — same-origin, browser-native, sub-ms latency, no server
- **Chrome's built-in Cast** — user mirrors the cast tab via browser menu → Chromecast
- **Security-first filter** — `toPublicPokerState` is tested against 91 permutations + 20 fuzz runs; hole cards never appear in the cast tab

## Package layout

```
src/
├── filters/          # toPublicPokerState, toPublicRouletteState — security core
├── sender/           # CastButton, CastModal, useCastSession, transport/
├── receiver/         # ReceiverFrame, PokerPublicView, RoulettePublicView, usePublicState
└── room/             # generateRoomCode (XXXX-XXXX, no ambiguous chars), getCastUrl
```

## Quick start

See `examples/poker-integration.md` and `examples/roulette-integration.md` for full integration steps.

### Sender (play page)

```tsx
import { CastButton } from '@pokerzeno/cast-bridge/sender';
import { toPublicPokerState } from '@pokerzeno/cast-bridge/filters';

<CastButton
  appName="PokerZeno"
  publicViewPath="/cast"
  state={fullGameState}
  filterFn={toPublicPokerState}
/>
```

### Receiver (cast page)

```tsx
// pokerzeno/src/app/cast/[roomId]/page.tsx
import { ReceiverFrame, PokerPublicView } from '@pokerzeno/cast-bridge/receiver';

export default function CastPage({ params }: { params: { roomId: string } }) {
  return (
    <ReceiverFrame appName="PokerZeno" roomId={params.roomId}>
      <PokerPublicView roomId={params.roomId} />
    </ReceiverFrame>
  );
}
```

## Tests

| Suite | Tests | Coverage |
|-------|-------|----------|
| `filters/poker-public` | 91 | All streets, side pots, dealer rotation, showdown, 9-player, fuzz |
| `filters/roulette-public` | 39 | All phases, all bet types, private field stripping |
| `transport/broadcast-channel` | 15 | Send/receive, STOP, multi-receiver, self-isolation, latency |
| `room/code` | 22 | Format, no ambiguous chars, 10k uniqueness, distribution |
| **E2E (Playwright)** | **4** | Real Chromium cross-tab sync, STOP, showdown, rapid updates |
| **Total** | **171** | |

```bash
npm test          # vitest unit tests (167 tests, ~800ms)
npm run test:e2e  # Playwright E2E (4 tests, real Chromium)
```

## v2 path (WebRTC)

The `src/sender/transport/webrtc.ts` stub is ready. When upgrading to a native Cast Receiver app:

1. Implement `WebRTCTransport` (same `Transport` interface)
2. Add Cloudflare Worker signaling helper
3. Change `createTransport('webrtc', roomId)` in `useCastSession`

All filter logic, public view components, and the `ReceiverFrame` are 100% reusable.

## Security

The `toPublicPokerState` filter:
- Constructs output field-by-field — never spreads `FullPlayer` or `FullGameState`
- Strips: `holeCards`, `balanceHint`, `coachOutput`, `handEquityPreview`, `isHoldingAce`, `isHoldingPair`, all `private*` fields, `castingPlayerSeat`
- At showdown: hole cards are converted to `PublicCard[]` (rank+suit only)
- Before showdown: replaced with `{ faceDown: true, count: N }`

The recursive `assertNoPrivateFields` walker runs on every test output to prove the invariant holds under all inputs.

## License

UNLICENSED — proprietary, all rights reserved.
