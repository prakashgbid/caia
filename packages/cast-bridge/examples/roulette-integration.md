# Roulette Community Integration

## 1. Add the cast route

Create `roulette-community/src/app/cast/[roomId]/page.tsx`:

```tsx
import { ReceiverFrame, RoulettePublicView } from '@pokerzeno/cast-bridge/receiver';

export default function CastPage({ params }: { params: { roomId: string } }) {
  return (
    <ReceiverFrame appName="Roulette" roomId={params.roomId}>
      <RoulettePublicView roomId={params.roomId} />
    </ReceiverFrame>
  );
}
```

## 2. Add CastButton to the play page

```tsx
import { CastButton } from '@pokerzeno/cast-bridge/sender';
import { toPublicRouletteState } from '@pokerzeno/cast-bridge/filters';

<CastButton
  appName="Roulette"
  publicViewPath="/cast"
  state={fullRouletteState}
  filterFn={toPublicRouletteState}
/>
```

## 3. What gets filtered

`toPublicRouletteState` strips:
- `castingPlayerBalance` — user's wallet balance
- `castingPlayerWinnings` — per-spin win/loss
- `castingPlayerBets` — user's private bets (shows only aggregate table bets)
- `castingPlayerNetSession` — session P&L

Everything else is public by nature: wheel number, board state, spin history, total pot.

## 4. User flow

Same as PokerZeno: Cast button → modal → open cast tab → Chrome Cast menu → TV mirrors the public wheel view. No balance or personal bets visible on TV.
