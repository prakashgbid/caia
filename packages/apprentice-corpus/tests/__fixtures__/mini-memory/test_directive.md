---
name: Test directive — fixture-only
description: Fixture for memory walker tests
type: project
---
# Test directive

This is a fixture directive used in unit tests. It exists so the memory-walker can be exercised against a non-CAIA corpus without coupling tests to the live agent/memory directory.

## Purpose

- Verify the walker classifies `*_directive.md` as `directive`
- Verify frontmatter is stripped from the body
- Verify the body becomes the artifact text

## Sample content

The walker should emit one RawArtifact for this file with `kind: 'directive'` and the body above.
