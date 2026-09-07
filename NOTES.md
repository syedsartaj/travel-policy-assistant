# Submission notes

## What I built

The optional brief: an assistant that answers a question by looking it up in
`travel_expense_policy.csv`, and states clearly when the policy does not cover
it. TypeScript on Node 20, zero runtime dependencies, 108 tests.

```bash
npm install && npm test && npm start -- "Can I expense a $95 dinner in Dubai?"
```

## What I would like you to look at

**The split between deciding and phrasing.** The pipeline is analyse → retrieve
→ decide → phrase, and only the last step is the model's. Coverage, the rules
used and the arithmetic are settled in ordinary tested code, then handed to a
model to put into English. The model is only ever shown the rules retrieval
selected, and is told plainly when there are none, so it has nothing to
hallucinate a limit *from*. That is also what makes the offline mode a real
mode rather than a stub: swapping in the hosted model changes the wording and
nothing else. `tests/model.test.ts` asserts the prompt for a Dubai question
contains the UAE limit and not the UK or India ones.

**The two de-duplication traps in the sample data, which pull opposite ways.**
Meals / United Kingdom is repeated with the same limit and wants collapsing.
Airfare / Global is *also* repeated — but those two rows carry different
conditions (economy under six hours, business over six), and collapsing on
category and region would have silently deleted the long-haul rule. So rows
group by category and region, rows with the same limit merge into one rule, and
their notes merge as its conditions, with a note dropped only when its words are
a subset of another's. `npm start -- --diagnostics "meals in the UK"` prints
what was merged; nothing is discarded quietly.

**Saying no properly.** Four different "no" answers, each decided before any
prose is written: a category the region has no rule for (taxi in India), a
region the policy has never heard of (Germany), an expense it is silent on (a
train fare), and a question that was never about the policy at all. A test
asserts that an answer the policy does not support quotes no figures at all.

**Money.** Integer minor units throughout, so an exactly-on-the-limit claim
comes out as allowed rather than a rounding error. A blank limit cell means "no
cap", never zero; two different limits for the same category and region take the
lower one and raise a warning.

## What I would do with more time

The two-hour guideline shaped this a good deal. In rough order of what I would
reach for first:

1. **Semantic retrieval alongside the alias table.** The current matching is
   deterministic and testable, which is why it is there, but it only knows the
   synonyms it has been given. Embedding the rules and the question — with the
   alias match kept as a high-precision fast path, and a similarity floor below
   which the answer stays "not covered" — would handle unusual phrasings without
   giving up the refusal behaviour. This is the change I would make first.
2. **A golden-answer suite for the hosted model.** The offline answers are
   asserted exactly. The hosted path is only tested for request shape and
   grounding, because asserting on generated prose is brittle. I would add a
   recorded-fixture suite plus a check that no figure appears in an answer that
   is not in the rules it was given — a guardrail rather than a string match.
3. **More of the policy's own structure.** Per-trip and monthly caps, effective
   dates so a policy can change mid-year, currencies other than USD with a rate
   source, and approval thresholds ("over this, it needs a manager").
4. **An HTTP surface and a batch mode.** The assistant is already a library with
   a structured `Answer`; a thin server and a "score this expense report" batch
   entry point are both small additions, and batch is the shape this is most
   useful in.
5. **Multi-turn follow-ups.** "And in London?" should keep the category from the
   previous question. Deliberately left out — it needs conversation state, and
   getting it wrong silently answers a question nobody asked.

## What I deliberately did not do

- **No exchange rates.** Asking in pounds gets a clear "this does not convert
  currencies, here is the USD limit". A guessed rate would look authoritative
  and be wrong.
- **No conversation memory**, per the point above.
- **No aliases I could not defend.** "Laundry" is not mapped to Incidentals and
  "tips" is not either — the policy genuinely does not price laundry, and tips
  appear in the *Meals* rule. A wrong alias produces a confident answer about
  the wrong rule, which a reader cannot distinguish from a right one.

## AI tools

I used Claude (Claude Code) while building this, mainly for scaffolding, drafting
tests and reviewing edge cases. The design decisions — the decide/phrase split,
the de-duplication rule, integer money, the coverage model — are mine, and I can
walk through any file in the repository and explain why it is the way it is.
