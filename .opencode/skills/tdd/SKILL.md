---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red to green loop.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. A good test reads like a specification.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods
- **Tautological** — assertion recomputes the expected value the way the code does
- **Horizontal slicing** — writing all tests first, then all implementation
