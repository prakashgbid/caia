---
"caia": minor
---

feat(@caia/ui): VoiceInput — browser-native dictation on every free-text field

Adds `VoiceInput` + `VoiceField` to `@caia/ui` and wires them into the
free-text inputs on the marketing site and the dashboard.

Reuse-first (ADR-065): the SpeechRecognition lifecycle, Web Speech API type
declarations and capability detection are adapted from `speech-input.tsx` in
vercel/ai-elements (Apache-2.0) rather than written from scratch — see the
new root `NOTICE` and the delta list in the component header. Vendored, not
depended upon, because AI Elements ships as a shadcn-style source registry
and `speech-input` is not yet published to registry.ai-sdk.dev. The single
new runtime dependency is `lucide-react` (ISC), the canonical shadcn icon
set, added to `packages/ui` only so apps keep importing the wrapper.

Wired:
  - apps/chiefaia-site — contact form (name, email, message)
  - apps/dashboard — submit "Requirement / Idea" brief intake, HumanGateModal
    feedback, RequirementsKanban title + description, QuestionsKanban custom
    answer, chat prompt

Deliberately not wired: password and API-key fields (transcripts are sent to
a third-party speech service by the browser, so secrets must never be
dictated — `VoiceField`'s `sensitive` prop makes the rule explicit); the
dashboard's one-line filter/search boxes; and `/dashboard/new-project`, which
is still a read-only factory explorer with no intake form.

Behaviour beyond upstream: interim transcripts are surfaced (upstream emits
final results only), the control carries an aria-label plus an aria-live
status region (upstream renders a button with no accessible name), Ctrl+M
toggles the mic for the focused field, and the locale comes from
`navigator.language` instead of a hardcoded `en-US`. Browsers without the
Web Speech API get a disabled mic explaining why rather than a missing
control.

Also bumps `packages/ui` to React 19 types/peers. The apps have shipped
React 19 since #695; the package still declared 18-only, which only surfaced
once a typed third-party component was imported into it.
