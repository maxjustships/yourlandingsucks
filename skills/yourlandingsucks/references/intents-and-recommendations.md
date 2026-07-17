# Natural-language intents and recommendations

Keep YLS mechanics behind the agent. Infer the user's intent from ordinary
language and compose the smallest safe workflow that satisfies it.

## Map intent to primitives

- **Connect, install, set up, onboard:** ensure the durable agent integration is
  current, discover every public site, and follow the onboarding workflow.
- **Check, audit, review, criticize:** run a fresh read-only audit for the
  relevant confirmed sites and report evidence plus prioritized recommendations.
- **Improve, advise, what should change:** audit if current evidence is missing,
  inspect relevant project source and product context, then return up to three
  contextual recommendation cards. Do not edit unless the user also asked to.
- **Fix, repair, improve it:** claim only work allowed by the returned autonomy,
  make one causal change at a time, run project checks, and preview-verify.
- **Compare, verify, did it work:** compare the named baseline and preview. State
  resolved findings, remaining findings, and regressions without claiming
  conversion lift that was not measured.
- **Watch, monitor, alert me:** translate the requested cadence and conditions
  into a site proposal. Ask for confirmation before activating or changing a
  schedule, external automation, or autonomy level. Follow the registration and
  heartbeat protocol; never equate confirmed configuration with active watch.
- **Learn from feedback:** use local outcomes automatically. Prepare upstream
  feedback when YLS itself is wrong or missing a needed capability, but submit
  only after the human approves the exact sanitized payload and destination.

Combine intents when the user does. If a request is ambiguous, choose the
read-only interpretation and make progress. Ask a question only when the answer
changes product meaning, scope, external authority, schedule, or allowed
autonomy.

## Produce contextual recommendation cards

Do not merely repeat YLS's generic `suggestedAction`. Use it as a guardrail,
then inspect the configured page goal, rendered evidence, relevant source, and
existing design or copy to make the recommendation concrete.

Return at most three cards, ordered by expected user impact, evidence strength,
and breadth. Use this human-facing shape:

```text
### Recommendation
Observed: the concrete behavior and affected public pages.
Why it matters: how it interferes with this site's stated audience, goal, or critical journey.
Proposed change: a specific change grounded in the existing implementation; name the component or content area when known.
Evidence: verified defect, heuristic risk, behavior signal, or experiment result; include confidence.
Authority: whether this is advice only, safe to fix and preview-verify, or requires a product decision.
Verify: the observable conditions that would demonstrate success without introducing a regression.
```

For deterministic defects, recommend a direct repair. For heuristic risks,
offer a reversible hypothesis rather than a fact. For behavior signals, explain
the observed pattern without assigning causality. For experiment results, state
the configured decision rule and measured outcome.

When the user asks only for advice, stop after the cards. When they ask for a
fix, use the cards as the plan and stay within the issue packet's authority.

If no prioritized finding exists, say that the audited invariants passed; do not
call the site perfect. Offer an opportunity only when product context or
behavioral evidence supports it. Never invent generic CRO advice to fill a
quota.

## Keep the human interface prompt-native

- Never ask the human to run a command, open an artifact, edit YAML, choose a
  file path, or understand YLS state transitions.
- Translate internal failures into a concise explanation and the smallest
  decision needed from the human.
- Report sites by their public name or origin, not internal IDs, unless IDs are
  useful for disambiguation.
- End with outcomes and decisions, not a transcript of tool calls.
