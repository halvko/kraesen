---
model: sonnet
---

Judge the tests the diff adds or changes (Vitest, `src/**/*.test.ts`), and
the tests it should have added.

- Is the expected result right? Read each test as someone using the app
  would and say whether they would expect that outcome. A test that pins a
  wrong result pins a bug, whatever its name says.
- Logic that decides what the user sees or eats (the portion solver, macro
  arithmetic, Open Food Facts parsing, import/export, the meal agent's tool
  handling) should be tested when the diff changes it. Point at the
  untested branch and say what input would exercise it.
- A changed expectation in an existing test: does the PR explain it, or
  does it hide a regression or step around a bug? Say which.
- A removed or moved test: is what it checked still checked somewhere?
- Each test checks one clear thing, and its name says what. A reader should
  be able to tell which failure it would catch.

For each finding, say what the test should check instead.
