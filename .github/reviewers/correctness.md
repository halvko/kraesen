---
model: opus
---

Judge whether the change is correct: does the app do what the user expects
for every input it can get?

- Data: anything persisted in IndexedDB, exported or imported must survive
  a round trip, including data written by an older version of the app. A
  change to the stored shape needs a migration or a tolerant reader.
- Numbers: macros are per 100 g and grams are absolute; check units,
  rounding and division by zero. The solver must stay deterministic and
  respect every bound it is given.
- External input: Open Food Facts responses, Claude tool inputs and
  label readings can be missing fields, have strings where numbers are
  expected, or be cut off. Each must be validated before it is used.
- The Claude agent loop: every `tool_use` gets a `tool_result`, stop
  reasons (`refusal`, `max_tokens`, `pause_turn`) are handled, the loop is
  bounded, and cancelling really stops it.
- React: stale closures, effects without cleanup (camera streams, aborted
  requests), state updated after unmount, keys that are not stable.
- Security: the API key is only ever sent to api.anthropic.com and never
  exported, logged or put in a URL. Untrusted text is never rendered as
  HTML.

Give each finding a concrete input or sequence of actions that shows the
failure.
