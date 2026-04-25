# PokerZeno Integration

## 1. Install the package (monorepo)

In `pokerzeno/package.json`, add a workspace reference:
```json
{
  "dependencies": {
    "@pokerzeno/cast-bridge": "workspace:../cast-bridge"
  }
}
```

## 2. Add the cast route

Create `pokerzeno/src/app/cast/[roomId]/page.tsx`:

```tsx
import { ReceiverFrame, PokerPublicView } from '@pokerzeno/cast-bridge/receiver';

export default function CastPage({ params }: { params: { roomId: string } }) {
  return (
    <ReceiverFrame appName="PokerZeno" roomId={params.roomId}>
      <PokerPublicView roomId={params.roomId} />
    </ReceiverFrame>
  );
}
```

That's it — ~8 lines.

## 3. Add CastButton to the play page

In your `/play` page, import and drop in the button:

```tsx
import { CastButton } from '@pokerzeno/cast-bridge/sender';
import { toPublicPokerState } from '@pokerzeno/cast-bridge/filters';

// In your toolbar / top-right area:
<CastButton
  appName="PokerZeno"
  publicViewPath="/cast"
  state={fullGameState}          // your live FullGameState
  filterFn={toPublicPokerState}  // strips hole cards, balance, coach output
/>
```

The button manages the full lifecycle:
- Opens the cast tab at `/cast/<roomCode>`
- Walks the user through Chrome's Cast menu
- Publishes debounced filtered state on every state change
- Shows a "Casting" badge while active
- Sends STOP + closes the tab on "Stop casting"

## 4. User flow

1. Player opens PokerZeno at `/play`
2. Clicks **"Cast to TV"** (top-right)
3. Modal opens → click **"Open cast tab"** → a new tab at `/cast/XXXX-XXXX` opens
4. In the cast tab: browser menu → Cast → pick your Chromecast / TV
5. Back in the play tab: click **"Done — I'm casting"**
6. The cast tab mirrors to the TV. Hole cards stay private on the play tab.
7. Click **"Stop casting"** to end the session.

## 5. Security guarantee

`toPublicPokerState` constructs the public object field-by-field — it never spreads `FullPlayer` or `FullGameState`. The filter test suite (91 tests + 20 fuzz runs) verifies that `holeCards`, `balanceHint`, `coachOutput`, `handEquityPreview`, and all other private fields are never present in the output under any input permutation.
