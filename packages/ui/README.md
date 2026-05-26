# @caia/ui

Canonical shadcn/Tailwind component library for CAIA apps.

**Operator-locked 2026-05-25.** Every UI primitive used in `@caia/*` apps must come from this package, not from raw `@radix-ui/*` / shadcn-CLI-copied / Tailwind-only sources. The doctrine lives in [AGENTS.md > Reuse-first](../../AGENTS.md) and [caia-ea/decisions/ADR-065](https://github.com/prakashgbid/caia-ea/blob/main/decisions/ADR-065-reuse-first-as-enforced-discipline.md). Mechanical enforcement is in the Semgrep rules `caia-no-raw-shadcn-import-outside-ui-package` + `caia-no-raw-radix-outside-ui-package` and the `reuse-advisory` CI gate.

## What's exported

| Primitive | API surface | Underlying |
|-----------|-------------|------------|
| `Button` | `variant` (default/destructive/outline/secondary/ghost/link), `size` (default/sm/lg/icon) | pure Tailwind + cva |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | shadcn shape | pure Tailwind |
| `Input` | standard input attrs | pure Tailwind |
| `Badge` | `variant` (default/secondary/destructive/outline) | pure Tailwind + cva |
| `Progress` | `value` (0..100), `max` | pure Tailwind |
| `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | shadcn shape | React context (Radix-ready) |
| `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` | shadcn shape, controlled+uncontrolled | React state (Radix-ready) |
| `Sheet`, `SheetTrigger`, `SheetContent` | `side` (left/right/top/bottom) | React state (Radix-ready) |
| `ScrollArea` | passthrough | pure Tailwind (Radix-ready) |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | shadcn shape, controlled+uncontrolled | React context (Radix-ready) |
| `Label`, `FormField`, `FormDescription`, `FormErrorMessage` | minimal form primitives | pure Tailwind |
| `cn(...inputs)` | `clsx + tailwind-merge` | helper |

When `@radix-ui/react-*` packages land in the dependency tree, the implementations swap to Radix wrappers — the public API of each primitive stays stable so consumers don't have to change.

## Usage

```ts
// app entry — once
import "@caia/ui/styles.css";

// anywhere
import { Button, Card, CardHeader, CardTitle, cn } from "@caia/ui";

export function Example() {
  return (
    <Card className={cn("max-w-md")}>
      <CardHeader>
        <CardTitle>Hello</CardTitle>
      </CardHeader>
      <Button>Click me</Button>
    </Card>
  );
}
```

### Tailwind config

```ts
// app's tailwind.config.ts
import baseConfig from "@caia/ui/tailwind.config";

export default {
  ...baseConfig,
  content: [
    ...baseConfig.content,
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
```

### shadcn CLI

`components.json` is co-located so consumers can run `pnpm dlx shadcn add <primitive>` against this package's config when they need to pull in a primitive that isn't yet exported here. The expectation is that any such addition is made HERE first, then re-exported, before being consumed in apps.

## Adding a new primitive

1. Add the source in `src/components/ui/<name>.tsx`.
2. Re-export from `src/index.ts`.
3. Add a row to the table above.
4. Add a vitest unit test in `tests/<name>.test.tsx` (renders, basic interaction, a11y attributes).
5. Open a PR; do NOT bypass and copy the primitive into an app.

If you find a primitive copy-pasted into an app, file a follow-up issue to lift it into `@caia/ui` and remove the inline copy. The Semgrep rules are configured to surface these regressions on PR diff.
