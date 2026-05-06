# Test handoff — fixture

This is a synthetic handoff document used in unit tests for the reports-walker.

## Summary

The reports-walker should pick up this file because it lives at the root of `<reportsRoot>/` and ends with `.md`. Its kind is `report` and the entire body becomes the artifact text.

## Body

The body contains enough text to clear the minimum-length threshold so the normaliser keeps it as an InstructionPair. Operator's email prakashmailid@gmail.com appears in this fixture so the PII masker can be tested end-to-end against an email-shaped pattern.

The body also contains a path with username: /Users/test-user/some/file.md which the masker should normalise to ~/.

A fake API key shape: sk-abcdefghijklmnopqrstuvwxyz1234567890 should be redacted.
