/**
 * Canonical "complete idea" template.
 *
 * The 10 slots CAIA needs before it can produce a genuinely useful IA
 * pack + build brief. 5 required, 5 optional. Ordered by importance —
 * gap questions are asked in this order when multiple slots are missing.
 *
 * Every slot has:
 *   - name: machine key
 *   - label: human-readable name
 *   - required: whether the slot must be filled before we can proceed
 *   - kind: 'freeform' (string) | 'enum' (one of options) | 'freeform_list' (short list)
 *   - questionTemplate: warm question to ask when this slot is a gap
 *   - optionSeedPrompt: how the analyzer generates 4 multiple-choice options
 *   - enumOptions: only for kind='enum', a static list
 *
 * The analyzer LLM reads the founder's freeform text and outputs, for
 * each slot: { value: string|null, confidence: 0..1 }. Anything below
 * CONFIDENCE_THRESHOLD becomes a gap question in the follow-up survey.
 */

export const CONFIDENCE_THRESHOLD = 0.7;

export type SlotKind = 'freeform' | 'enum' | 'freeform_list';

export interface IdeaSlot {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly kind: SlotKind;
  readonly questionTemplate: string;
  readonly optionSeedPrompt: string;
  readonly enumOptions?: readonly string[];
}

export const IDEA_TEMPLATE: readonly IdeaSlot[] = [
  {
    name: 'vision',
    label: 'What you want to build',
    required: true,
    kind: 'freeform',
    questionTemplate:
      "In one sentence, what do you want to build? (You can say it however feels natural — 'an app that…', 'a website where…', 'a tool for…')",
    optionSeedPrompt:
      'Generate 4 plausible one-sentence descriptions of what this product could be, based on the founder text. Vary the framing (an app / a website / a marketplace / a tool). Each option ≤ 15 words.',
  },
  {
    name: 'problem',
    label: 'The problem it solves',
    required: true,
    kind: 'freeform',
    questionTemplate:
      "What problem or pain does this solve for people? What's the moment they'd say 'I wish something like this existed'?",
    optionSeedPrompt:
      'Generate 4 plausible one-sentence problem statements that this product could address, based on the founder text. Everyday-language, concrete moments (not abstract), ≤ 20 words each.',
  },
  {
    name: 'target_users',
    label: 'Who it helps',
    required: true,
    kind: 'freeform',
    questionTemplate:
      'Who is this for? Describe them in everyday language (kids, small-shop owners, freelance designers, neighbors, etc.).',
    optionSeedPrompt:
      'Generate 4 plausible target-user descriptions for this product. Use concrete everyday people (e.g., "home cooks in an apartment building" not "consumers"). ≤ 12 words each.',
  },
  {
    name: 'industry',
    label: 'What kind of app it is',
    required: true,
    kind: 'enum',
    questionTemplate: 'What kind of app is this most like?',
    optionSeedPrompt: '', // not used for enum
    enumOptions: [
      'Social / community',
      'Marketplace / directory',
      'Productivity / tool',
      'Learning / education',
      'Health / wellness',
      'Entertainment / games',
      'Finance / money',
      'Local / neighborhood',
      'Creator / media',
      'Other',
    ],
  },
  {
    name: 'must_have_features',
    label: 'The must-haves',
    required: true,
    kind: 'freeform_list',
    questionTemplate:
      'What are the top 2-3 things the app absolutely MUST do on day one? (Simple bullet points are fine.)',
    optionSeedPrompt:
      'Generate 4 plausible feature-set descriptions for this product\'s MVP. Each is a short bulleted list of 2-3 features. Concrete verbs (post, browse, save, share). Each option ≤ 30 words total.',
  },
  {
    name: 'nice_to_have_features',
    label: 'The nice-to-haves',
    required: false,
    kind: 'freeform_list',
    questionTemplate:
      'What would make this app extra delightful, that could wait until v2? (Also fine to skip if nothing comes to mind.)',
    optionSeedPrompt:
      'Generate 4 plausible v2 / nice-to-have feature ideas for this product. Each is a short bulleted list of 2-3 items. ≤ 30 words per option.',
  },
  {
    name: 'tone',
    label: 'The vibe',
    required: false,
    kind: 'enum',
    questionTemplate: 'How should the app feel?',
    optionSeedPrompt: '',
    enumOptions: [
      'Playful and fun',
      'Warm and inviting',
      'Professional and trustworthy',
      'Calm and minimal',
      'Energetic and bold',
      'Not sure — surprise me',
    ],
  },
  {
    name: 'inspirations',
    label: 'Apps you love that feel similar',
    required: false,
    kind: 'freeform_list',
    questionTemplate:
      'Are there any apps or websites you love that this should feel a little like? (Even if the use case is different.)',
    optionSeedPrompt:
      'Suggest 4 well-known apps or websites whose feel this product might borrow from, based on its purpose. Each option is 1-3 named products separated by " + ". Examples: "Instagram + Nextdoor", "Notion + Slack".',
  },
  {
    name: 'success_metric',
    label: 'How you\'d know it\'s working',
    required: false,
    kind: 'freeform',
    questionTemplate:
      "What would make you say 'this is working!' after a month of real people using it?",
    optionSeedPrompt:
      'Generate 4 plausible user-centric success signals for this product. Not revenue — behavioral signals ("50 people post something in their first week"). ≤ 20 words each.',
  },
  {
    name: 'known_risks',
    label: 'What worries you about it',
    required: false,
    kind: 'freeform',
    questionTemplate:
      "Is there anything about this idea that worries you or feels hard? (Totally fine to say 'nothing yet' — we'll surface concerns during design too.)",
    optionSeedPrompt:
      'Generate 4 plausible honest concerns a first-time founder might have about this specific product. Practical, human-scale worries (not "TAM" or "unit economics"). ≤ 20 words each.',
  },
];

export function isRequired(slotName: string): boolean {
  const slot = IDEA_TEMPLATE.find((s) => s.name === slotName);
  return !!slot?.required;
}

export function getSlot(name: string): IdeaSlot | undefined {
  return IDEA_TEMPLATE.find((s) => s.name === name);
}

export function requiredSlotNames(): string[] {
  return IDEA_TEMPLATE.filter((s) => s.required).map((s) => s.name);
}

export function allSlotNames(): string[] {
  return IDEA_TEMPLATE.map((s) => s.name);
}
