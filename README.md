# Travel policy assistant

Answers questions about a company travel-expense policy from a CSV, and says
plainly when the policy does not cover the question.

```
$ npm start -- "Can I expense a $95 dinner in Dubai?"

Over the limit.
Meals in the United Arab Emirates: USD 90.00 per day. USD 95.00 is USD 5.00 over. The excess needs approval before it can be claimed.

Source: travel_expense_policy.csv — Meals / United Arab Emirates (line 4)
```

## Running it

Node 20.6 or newer. Nothing else — no API key, no account, no paid service, no
model download, and no network at run time.

```bash
npm install
npm test
npm start -- "What is the hotel limit in London?"
npm start                       # interactive, ask as many as you like
```

Other things you can do:

```bash
npm start -- --json "Can I claim a taxi in India?"     # machine-readable
npm start -- --diagnostics "meals in the UK"           # what loading the CSV decided
npm start -- --policy ./my-policy.csv "..."            # a different policy file
npm start -- --help
npm run build && node dist/cli.js "..."                # compiled
```

## What it does with the questions

| Question | Answer |
| --- | --- |
| `Can I expense a $95 dinner in Dubai?` | Over the limit, by USD 5.00 |
| `Is a 3 night hotel stay in London at $700 within policy?` | Over — USD 220.00 × 3 = USD 660.00 |
| `Can I fly business class on an 8 hour flight?` | Yes: permitted over 6 hours |
| `Can I fly business class on a 3 hour flight?` | Economy only under 6 hours |
| `Can I claim a taxi in India?` | **Not covered** — Taxi is priced for the UK only |
| `What is the meal limit in Germany?` | **Not covered** — no rule for Germany |
| `Can I claim the train to Manchester?` | **Not covered** — the policy has no rail rule |
| `Can I claim £60 for lunch in London?` | It will not convert currencies; here is the USD limit |
| `How much can I spend in Dubai?` | Everything the policy says about the UAE |
| `What is the capital of France?` | Out of scope |

## How it works

```
question ─▶ analyse ─▶ retrieve ─▶ decide ─▶ phrase ─▶ answer
            (parse)    (find the   (compare  (a model
                        rules)      money)    writes it)
```

Only the last step belongs to the model. Coverage, the rules used and the
verdict are all computed in ordinary, tested code first, and the model is handed
that result and asked to say it in English. It never sees a rule that is not in
the policy, and it is told explicitly when there are none — so the worst a bad
generation can do is word something awkwardly. It cannot invent a limit.

Every answer carries the structured result alongside the prose, so a caller
never has to parse English:

```bash
$ npm start -- --json "Can I claim a taxi in India?"
{
  "coverage": "not_covered",
  "verdict": null,
  "citations": [],
  "provider": "offline",
  ...
}
```

## The model interface

```ts
interface LanguageModel {
  readonly id: string;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
```

Two implementations:

- **`offline`** (default) — a deterministic composer. Same question, same words,
  every time. No network, no credentials, no downloads. This is what makes the
  repository runnable by someone who has never seen it.
- **`anthropic`** (optional) — the same pipeline, with the Anthropic Messages
  API phrasing the final answer. Reads `ANTHROPIC_API_KEY` from the environment.

```bash
export ANTHROPIC_API_KEY=sk-...      # or: cp .env.example .env; node --env-file=.env ...
npm start -- --provider anthropic "Can I expense a $95 dinner in Dubai?"
```

Asking for `anthropic` without a key is an error, not a silent fall back to
offline. No credential is committed, logged, or written anywhere.

## Decisions worth explaining

**Money is integer minor units, never floats.** Limits get compared against
claims. A claim of exactly $75.00 against a $75 limit has to come out as "on the
limit", and `0.1 + 0.2 !== 0.3` is not a risk worth taking in something that
decides what people get paid back.

**Duplicate rows are resolved by what they constrain, not by row equality.**
The sample file has two traps, and they pull in opposite directions:

- Meals / United Kingdom appears twice with the same limit. The second row's
  note is an aside, so it says nothing the first does not — one rule.
- Airfare / Global *also* appears twice, but the two rows carry different
  conditions: economy under six hours, business over six. De-duplicating on
  category and region alone would silently delete the long-haul rule.

So rows are grouped by category and region, rows with the same limit merge into
one rule, and their notes merge as its conditions — with a note dropped only
when its words are a subset of another's. `--diagnostics` prints what happened.

**Two rows with different limits are a conflict, not a merge.** The lower limit
wins and a warning is raised. Under-reimbursing someone is recoverable; telling
them they may spend more than the policy allows is not.

**"Global" is a fallback, never an override.** An airfare question about London
is answered by the worldwide rule, and the answer says that is what happened. A
region with its own rule always beats the worldwide one.

**Not covered is a first-class answer.** Three verdicts — `covered`,
`not_covered`, `out_of_scope` — decided before any prose is written. A test
asserts that an answer the policy does not support contains no figures at all,
which holds structurally: with nothing retrieved there is nothing to quote.

**It will not convert currencies.** Ask in pounds and it says so and shows the
USD limit. A made-up exchange rate would produce an answer that looks
authoritative and is not.

**No categories or regions are hardcoded.** They come from the file, so a
different policy CSV works without a code change. The one place that knows
English — that "Dubai" is in the UAE and "cab" means taxi — is
[`src/retrieval/vocabulary.ts`](src/retrieval/vocabulary.ts), and it is
deliberately conservative: a wrong guess produces a confident answer about the
wrong rule, which is worse than saying "not covered".

**Zero runtime dependencies.** Including the CSV reader. `npm install` pulls
TypeScript and Vitest and nothing that ends up in the running program.

## Layout

```
data/travel_expense_policy.csv  the policy
src/
  policy/      csv reader, and turning rows into rules
  retrieval/   reading the question, finding the rules that bear on it
  answer/      the verdict, and describing rules in English
  model/       the LanguageModel interface, offline and anthropic
  assistant.ts the pipeline
  cli.ts       one-shot and interactive
tests/         108 tests
```

## Tests

```bash
npm test          # 108 tests, ~1s
npm run typecheck # strict, with noUncheckedIndexedAccess
```

GitHub Actions runs both, plus the build and one real question with no secrets
in the environment, on Node 20 and 22 — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

They cover the CSV reader's edge cases, the de-duplication and conflict rules,
question parsing, retrieval and the fallback, the money arithmetic, the
end-to-end answers, and the hosted model — including that its prompt contains
the retrieved rules and no others. The hosted path is tested with an injected
`fetch`, so the suite needs no key and no network.

## Known limits

Listed rather than hidden. See [NOTES.md](NOTES.md) for what I would do next.

- Question parsing is deterministic string work, not semantic search. It
  understands the aliases in `vocabulary.ts`; an unusual phrasing falls through
  to "not covered" rather than being guessed at.
- An unrecognised place is only spotted when it is capitalised, so
  `meals in germany` lists every region instead of saying Germany is not
  covered. It fails toward showing more of the policy, not toward a wrong
  refusal.
- One policy file at a time, loaded into memory. It is a small policy.
- No conversation memory — each question is answered on its own.
