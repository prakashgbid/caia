# Worked examples — three fictional startups

These three examples illustrate how the Interviewer Agent drives a conversation through the playbook to a startup-grade plan in 20-40 turns. For each fictional founder, you see:

1. **Idea sketch** — what the founder walks in with.
2. **Opening turn (turn 1)** — agent's cold-start, five questions across foundational pillars.
3. **Mid-interview turn (turn 8-15)** — agent has spotted a gap and is depth-drilling.
4. **Late-interview turn (turn 25-32)** — agent challenges a contradiction or forces a deferred decision.
5. **Plan excerpt at handoff** — one or two sections of the resulting BusinessPlanV2 JSON, demonstrating investor-grade quality.

The examples are illustrative — not regression fixtures. Use them as referent shapes when in doubt about the bar.

---

## Example 1 — Alice / "ConsentLane" (B2B SaaS, clear thesis)

**Founder.** Alice, ex-product-manager at a privacy-tech company, two years in customer-discovery, $250K of personal savings, no cofounder, talked to 30 prospects already.

**Idea sketch.** A B2B SaaS that automates GDPR Article-30 Records of Processing Activities (RoPA) for mid-market companies — replacing the spreadsheet/wiki-page mess most DPOs maintain by hand. Tagline candidate: *"RoPA as a service — your Article 30 register, always current."*

### Opening turn (turn 1, breadth-first)

**Agent.** "Switching from intro to fact-finding — these five questions give me your plan's skeleton."

1. *(B5-Q01)* Describe the RoPA problem in your customers' own words — not yours.
2. *(B3-Q01)* Who exactly is the customer? Industry, role, company size, geography.
3. *(B6-Q01)* What ships at MVP launch, in seven features or fewer?
4. *(B2-Q01)* What are you saying is the size of this market, and where did you get the number?
5. *(B4-Q01)* Three direct competitors with URLs to their pricing pages.

**Alice's reply (paraphrased).** "DPOs say their RoPA is *'always 6 months stale and I'm terrified of an audit'*. Target is DPOs and Privacy Counsel at EU-headquartered companies 200-2000 employees, mostly SaaS and fintech, EU-only year 1. MVP: (1) auto-discover data-processing activities from existing GitHub/Jira/Slack signals, (2) editor for activities, (3) DPO sign-off workflow, (4) export to PDF for regulators, (5) Article 30 template library. Five features. EU privacy-tech SaaS TAM reported at $1.8B 2026 by Gartner; bottom-up I count ~14,000 EU companies above 200 headcount that need this — at €5K/yr that's €70M. Direct competitors: OneTrust (onetrust.com/pricing — enterprise-only, ~$30K floor), Privado (privado.ai/pricing — developer-focused, $0-15K), Securiti (securiti.ai — enterprise too)."

**Agent ingests.** Confidence updates: B.5 problem (75), B.3 ICP (80), B.6 MVP (70 — needs success criterion), B.2 TAM (60 — bottom-up + top-down OK but no SAM/SOM yet), B.4 direct competitors (85, three named with URLs).

### Mid-interview turn (turn 9, depth-first on B.6 + B.7)

**Agent.** "Your MVP list is tight. Now I need to fence year 1 against MVP — three questions."

1. *(B7-Q01)* By month 12, the product looks like what — list the 5-10 features that exist at end-of-year-1 but not in MVP.
2. *(B7-Q02)* Which of those 1-year features are gated on MVP signal — we only build them if MVP returns X? Name the signal.
3. *(B6-Q08 + B6-Q09)* MVP success criterion in one sentence with a number and a horizon. And MVP failure criterion — what does "kill or pivot" look like at month 6?

**Alice's reply.** "Year 1 additions: (a) auto-DPIA generation, (b) Slack/Teams alerting for new processing activities, (c) integrations with the top 5 CMPs, (d) DSR (Data Subject Request) flow, (e) multi-entity rollup for groups, (f) compliance-score dashboard. (a) DPIA is unconditional. (b)-(f) are all gated on the signal: '> 30 paying customers at €5K+ ARR by month 9.' Success criterion: 25 paying €5K+ logos by month 6. Failure criterion: < 10 paying logos by month 6 means we re-examine the wedge (probably pivot from auto-discovery to a manual-RoPA tool first, then re-add auto-discovery)."

**Agent ingests.** B.6 success/failure criteria locked. B.7 1-year list with 1 unconditional + 5 conditional — clean horizon discipline. Confidence B.6 → 88, B.7 → 80.

### Late-interview turn (turn 27, contradiction clarification)

**Agent.** "Earlier on turn 7 you described the buyer as the DPO. On turn 22 you said the buy decision is made by Privacy Counsel because they own the budget line and the DPO is a Privacy-team member with input but no signoff. These are two different buyers. Walk me through the actual procurement chain at, say, a 500-person fintech: who initiates, who evaluates, who signs the SOW?"

**Alice.** "Privacy Counsel signs the SOW. DPO is the user / champion who pushes the evaluation. CFO sign-off above €25K ACV. Triggering event is usually a DPIA backlog or a regulator letter — about 40% of my interviews mentioned the regulator-letter trigger."

**Agent.** Recording: `buyer = Privacy Counsel`, `user = DPO`, `economic buyer = CFO above €25K`, `trigger = DPIA backlog OR regulator letter`. Confidence clamp on B.3 buyerVsUser cleared.

### Plan excerpt at handoff (turn 34)

```json
{
  "customerICP": {
    "content": "ConsentLane targets mid-market EU companies (200-2000 employees, SaaS and fintech first) where Privacy Counsel owns the GDPR compliance budget and the DPO is the daily user. The trigger event is a DPIA backlog of >30 open activities OR a regulator information request — in 30 customer interviews, 12 of 30 named the regulator letter directly, 18 of 30 named the DPIA backlog. Buyer = Privacy Counsel, user = DPO, economic buyer = CFO for deals above €25K. The negative persona is the enterprise tier (>5000 employees) where OneTrust has incumbency and the deal cycle is 9-18 months. Acquisition channel #1: IAPP conference + privacy-counsel community sponsorships; #2: SEO on long-tail RoPA queries (e.g., 'Article 30 template SaaS'). 30 customer interviews completed, 12 verbatim quotes captured, 4 LOIs at €5K MRR conditioned on MVP shipping by Sept 2026.",
    "confidence": 88,
    "decisionedAtTurn": 27,
    "structured": {
      "firmographics": {
        "industry": "SaaS, fintech",
        "employeeRange": "200-2000",
        "revenueRange": "€30M-300M ARR",
        "geography": ["EU"],
        "growthStage": "growth"
      },
      "buyerVsUser": {
        "buyer": "Privacy Counsel",
        "user": "DPO",
        "sameOrDifferent": "different"
      },
      "negativePersona": "Enterprise tier >5000 employees where OneTrust has incumbency",
      "jtbd": {
        "situation": "DPIA backlog or regulator information request",
        "motivation": "Ship an accurate Article-30 RoPA without spending three weeks rebuilding the spreadsheet",
        "outcome": "Defensible compliance posture with audit-ready evidence",
        "functional": "Maintain an always-current RoPA",
        "emotional": "Reduce fear of a regulator finding",
        "social": "Be seen by the board as on top of compliance"
      },
      "customerDiscoveryDepth": {
        "customersInterviewed": 30,
        "verbatimQuotes": [
          "My RoPA is always 6 months stale and I'm terrified of an audit",
          "Every DPIA takes a week and I have 14 open",
          "We got a regulator letter in March, that's when I started looking"
        ]
      }
    },
    "pillarsCovered": ["B3"]
  },
  "mvpScope": {
    "content": "Five MVP features. (1) Auto-discover data-processing activities from existing GitHub/Jira/Slack signals — tests the hypothesis that auto-discovery is the primary wedge against manual-spreadsheet incumbents. (2) Activity editor — tests that DPOs will trust an automated draft enough to edit rather than rebuild. (3) DPO sign-off workflow — tests that Privacy-Counsel-as-buyer / DPO-as-user split holds in practice. (4) PDF export to Article-30-template format — required for regulator-readiness. (5) Article-30 template library — supports the manual-mode pivot fallback if auto-discovery underperforms. Success criterion: 25 paying €5K+ logos by month 6. Failure criterion: <10 paying logos by month 6 forces a pivot to manual-RoPA-first. Out of scope for MVP: DPIA generation (year 1 unconditional), DSR flow, multi-entity rollup, compliance scoring.",
    "confidence": 90,
    "decisionedAtTurn": 9,
    "structured": {
      "features": [
        { "name": "Auto-discover processing activities", "benefit": "RoPA stops going stale", "hypothesisTested": "Auto-discovery is the primary wedge" },
        { "name": "Activity editor", "benefit": "DPO trusts the draft", "hypothesisTested": "DPOs will edit not rebuild" },
        { "name": "DPO sign-off workflow", "benefit": "Privacy-Counsel-DPO collaboration works in product", "hypothesisTested": "Buyer/user split holds" },
        { "name": "PDF Article-30 export", "benefit": "Regulator-readiness", "hypothesisTested": "Compliance artifact is sufficient evidence" },
        { "name": "Article-30 template library", "benefit": "Manual-mode fallback", "hypothesisTested": "Pivot-to-manual viable" }
      ],
      "successCriterion": { "metric": "Paying €5K+ logos", "threshold": 25, "horizon": "month 6" },
      "failureCriterion": { "metric": "Paying €5K+ logos", "threshold": 10, "horizon": "month 6" },
      "paywall": "trial",
      "polishFloor": 7
    }
  }
}
```

**Critic-pass result.** Recommendation: `meeting`. Top positive factor: "30 customer interviews with 4 LOIs — rare specificity at this stage." Top negative factor: "Solo founder with no technical cofounder — confirms need to hire CTO before raising seed." Meeting question: "What's your CTO-hire plan, and what's your runway if the hire takes 6 months?"

---

## Example 2 — Bob / "GreenZap" (D2C consumer, vague thesis)

**Founder.** Bob, ex-marketing-lead at a sustainability brand, $80K seed-money cobbled from friends and family, has not talked to any prospects yet but "knows the space."

**Idea sketch.** A D2C subscription that sends customers a curated monthly box of "low-carbon" household-product swaps — laundry sheets, refillable shampoo, etc. Tagline: *"Net zero, made easy."*

### Opening turn (turn 1)

Same five-question fixture as Alice. Bob's answers are noticeably weaker:

- *Problem:* "People want to be sustainable but don't know how" — agent flags as a *vague pain*; no customer quote yet.
- *Customer:* "Millennials and Gen-Z" — agent flags as *all-of-humanity* (rubric audience-focus would clamp at 2).
- *MVP:* "A monthly box with 5 sustainable items" — agent flags as one feature, not five.
- *Market:* "The sustainable-products market is $200B globally" — agent demands the source.
- *Competition:* "Grove Collaborative, Blueland" — only two; one URL is wrong.

### Mid-interview turn (turn 6, Mom Test enforcement)

**Agent.** "You've said millennials want this. Question for you — and answer honestly because it changes the next 20 questions: *(B3-Q08)* have you talked to 10 of these customers yet? 5? 1? Zero?"

**Bob.** "I haven't done formal interviews. I've talked to maybe 8 friends who all loved the idea."

**Agent.** "Friends-of-founder give compliments, not commercial intent. Three questions for the next turn:

1. Pick five strangers from your target persona (millennial / Gen-Z, $50-100K HHI, no current sustainability subscription). What's your plan to talk to them in the next two weeks?
2. For each of the eight friends you've spoken to — has any of them spent money in the last 12 months trying to make their home more sustainable? Specifically: refillable cleaners, low-carbon laundry, anything? Quote what they actually bought.
3. Of those eight, how many are currently subscribed to Blueland or Grove Collaborative? If zero, what does that tell you about the persona's willingness to subscribe?"

**Bob's reply.** "Honestly… one of the eight tried Grove and cancelled after 3 months. Most of them buy sustainable stuff on Amazon ad-hoc. They don't subscribe."

**Agent records.** Confidence B.3 → 30. B.3-Q08 answered. Customer-discovery debt is now the highest-priority gap.

### Late-interview turn (turn 22, forcing the decision)

**Agent.** "We've spent 9 turns on customer discovery — your answers keep showing that the persona buys ad-hoc, not by subscription. Three options to make MVP testable:

A. Pivot the model to a one-time 'starter kit' with email-driven re-engagement (no subscription friction).
B. Keep the subscription but require a 20-customer interview round before MVP build — pause the interview and resume after homework.
C. Stick with the subscription and accept a higher MVP failure-rate (kill criterion: < 50 active subscribers by month 4).

Pick A, B, or C."

**Bob.** "B — let me go do the interviews. I think the model might shift."

**Agent.** PAUSED with `resume_after: customer-discovery-homework`, target `≥ 20 verbatim interviews`, suggested resume horizon: 14 days. Plan-so-far snapshot pinned at turn 22.

### Plan excerpt at handoff (post-pause, turn 38)

Bob came back after 18 days with 22 customer interviews — 6 of which converted to "would prepay for a one-time starter kit" but only 2 of which converted to subscription intent. The agent pivoted the plan to a starter-kit model with a subscription upsell.

```json
{
  "problemStatement": {
    "content": "Sustainability-curious 28-42 year-olds in the US ($60-120K HHI, urban / suburban) want their household consumption to feel less wasteful but lack a one-click way to discover and try the 5-10 specific product swaps that would meaningfully reduce their household carbon footprint. In 22 customer interviews, 16/22 reported having bought 'at least one sustainable swap' in the last 12 months but only 3/22 sustained a subscription beyond 3 months — the rest churned, citing 'fatigue with the ongoing curation surprise.' The bought-once-tried pattern is the most-quoted pain ('I love the idea but I don't need a new box every month, I just want the five things that actually work'). Cost of problem today: customers spend $15-40/month on un-coordinated sustainable swaps with 50%+ wasted on duplicates or unloved items. Pain rank 6/10; not high enough alone to drive subscription, but high enough to drive a one-time $89 starter-kit with optional refills.",
    "confidence": 72,
    "decisionedAtTurn": 28,
    "rationale": [
      "Pivoted from subscription to starter-kit model based on 22-interview customer-discovery data",
      "Subscription churn finding (Grove cancellation by friend at month 3, repeated in 13/22 prospect interviews) drove the model pivot"
    ]
  },
  "mvpScope": {
    "structured": {
      "features": [
        { "name": "Starter-kit landing page with 8 SKUs", "benefit": "One-click discovery", "hypothesisTested": "Starter-kit beats subscription for this persona" },
        { "name": "Refill email sequence (no subscription)", "benefit": "Re-engagement without commitment", "hypothesisTested": "Email-driven re-orders > subscription auto-bill" },
        { "name": "Carbon-impact calculator", "benefit": "Trust-building", "hypothesisTested": "Quantified impact lifts conversion" },
        { "name": "Stripe checkout + Klaviyo flows", "benefit": "Ship without backend", "hypothesisTested": "No-code stack is enough at this stage" }
      ],
      "successCriterion": { "metric": "Starter kits sold", "threshold": 200, "horizon": "month 3" },
      "failureCriterion": { "metric": "Starter kits sold", "threshold": 50, "horizon": "month 3" },
      "paywall": "paywall",
      "polishFloor": 5
    }
  }
}
```

**Critic-pass result.** Recommendation: `pass_kind`. "Pivoted thoughtfully from subscription to starter-kit based on real data — that's the sign of a coachable founder. But TAM is still unfocused, and the team is a solo non-technical founder. Come back at $30K MRR with 6 months of repeat-purchase data."

---

## Example 3 — Carol / "ToolLoop" (developer marketplace, contradictory founder)

**Founder.** Carol, two-cofounder team (Carol = product, Vikram = engineering), three months into the idea, no funding, 3 prospect interviews.

**Idea sketch.** A two-sided marketplace where independent CLI-tool builders can publish, monetize, and get auto-updated by enterprise IT teams. Pitch: *"npm for enterprise CLIs, with a marketplace layer."*

### Opening turn (turn 1)

Carol's answers:

- *Problem:* "Engineers love CLI tools but enterprises can't ship them at scale" — quotes nobody.
- *Customer:* "Two sides — CLI builders, and IT teams that want a self-service catalog."
- *MVP:* "(1) Tool publishing, (2) auto-update, (3) marketplace browse, (4) usage analytics, (5) admin allowlist, (6) SSO, (7) billing split" — seven features, full hand.
- *Market:* "Hard to size — somewhere between $500M and $5B."
- *Competition:* "GitHub Marketplace, but only sort of."

### Mid-interview turn (turn 12, two-sided market focus)

**Agent.** "Two-sided marketplaces need to pick a chicken-or-egg start. Three questions:

1. *(two-sidedness)* Which side do you light up first — builders, or IT teams? Defend in one sentence.
2. *(B6-Q01)* You listed 7 MVP features. With a two-sided market, the right MVP is usually 3 features per side, total 6. Which 1 of your 7 is cuttable?
3. *(B12-Q06)* You said no funding yet. Two-sided marketplaces typically need $500K-1M of capital to seed both sides simultaneously — is that capital plan in scope, or are you running a 'single-side first' play?"

**Carol.** "Builders first — without supply, the catalog is empty. Cut billing-split from MVP (we'll do it manually for the first 10 builders). Capital plan is to bootstrap to 50 published tools, then raise on that signal."

**Agent.** Recording: `seedSide = builders`, MVP features cut to 6, capital strategy = `bootstrap_to_signal`.

### Late-interview turn (turn 26, contradiction)

**Agent.** "Earlier on turn 4 you said the buyer is 'IT teams that want a self-service catalog' and your wedge is *'better discoverability for enterprise IT.'* Just now (turn 25) you said your first month-1 launch plan is to recruit 50 CLI tool builders from the Rust developer Slack and Hacker News. Those are different audiences with different acquisition channels and different pricing models. Which is the MVP buyer?"

**Carol.** "Builders are the seed-side users, IT teams are the eventual buyers. Builders get free, IT teams pay. So MVP customer = builders (free), revenue = IT teams (paid, year 1)."

**Agent.** Recording: MVP customer = builders (free / no paying customer at MVP). Year-1 paying customer = IT teams. Confidence B.1 (business model) clamp lifted at 70. New `openUnknown`: "What's the conversion mechanic from free-builder-side traction to paid-IT-side licensing?" Suggested default: "Builder-side traction (50 published tools, 1K downloads) becomes the IT-side outbound pitch evidence." Blocking: false (deferrable to 1-year).

### Plan excerpt at handoff (turn 36)

```json
{
  "businessModel": {
    "content": "Two-sided marketplace: builders publish CLI tools for free (no charge at MVP, no charge at year 1), IT teams subscribe to a managed catalog with usage analytics, allowlisting, SSO, and auto-updates for the tools their developers want. Pricing for IT teams: $5/developer/month (Lean Canvas block 9). At MVP, no revenue — the success metric is supply-side: 50 published tools by month 3. Year-1 revenue model unlocks once supply hits the threshold — first 10 IT-team customers via outbound to engineering leadership at the companies whose engineers are already publishing tools (a built-in warm-channel mechanic). Billing handled by Stripe Connect for builder-payouts in year 1 (deferred from MVP). Refund policy: monthly, no questions asked, prorated to date.",
    "confidence": 78,
    "decisionedAtTurn": 26,
    "structured": {
      "revenueModel": "subscription",
      "publicComparable": "GitHub Marketplace + Snyk (the dual-sided dev-tools model)",
      "unitOfValue": { "thing": "Developer seat (IT-side)", "pricePerUnit": 5, "frequency": "monthly" },
      "salesMotion": "self_serve",
      "contractLength": "monthly",
      "billingProvider": "Stripe Connect (year 1)",
      "freeTier": "freemium"
    }
  },
  "openUnknowns": [
    {
      "pillar": "B1",
      "question_id": "B1-conv-mechanic",
      "question": "What's the conversion mechanic from free-builder-side traction to paid-IT-side licensing?",
      "suggestedDefault": "Builder-side traction (50 published tools, 1K downloads) becomes the IT-side outbound pitch evidence; founder runs 20 IT-side cold outreaches in month 4 with this as proof.",
      "blocking": false,
      "reason": "deferred_3x"
    }
  ]
}
```

**Critic-pass result.** Recommendation: `pass_kind`. "Two-sided marketplaces are hard. Carol/Vikram have a clear seed-side plan but the demand-side conversion is hand-waved — *'IT-side outbound at month 4'* is a hope, not a plan. Come back with 5 paying IT-side LOIs from companies whose developers are already publishing — that's the only signal that matters."

---

## What the three examples teach the agent

1. **Alice (clear)** — the agent's job is to *deepen* — drive the founder to specificity, force horizon discipline, surface contradictions, finalize with high confidence. End state: critic-pass `meeting`.
2. **Bob (vague)** — the agent's job is to *humble* — refuse to accept friends-of-founder customer-discovery, force a pause for real interviews, accept a pivot. End state: critic-pass `pass_kind` with explicit "come back with X" condition.
3. **Carol (contradictory)** — the agent's job is to *resolve* — surface buyer/user/economic-buyer splits, force one-side-first prioritization, accept deferred-but-flagged unknowns. End state: critic-pass `pass_kind` with one explicit `openUnknown` (the conversion mechanic) and a clear "come back with proof" gate.

Across all three, the playbook delivered:
- All 16 pillars touched at least once.
- Per-pillar coverage ≥ 60 on at least 12 of 16 pillars.
- Three-horizon scope (MVP / 1yr / 5yr) explicitly populated.
- Critic-pass outcomes calibrated against realistic founder profiles (one `meeting`, two `pass_kind`).
- 25-40 turns total — the operator's expected range.
