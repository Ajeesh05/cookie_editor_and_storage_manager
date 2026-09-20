# Changelog

## 1.1.0 - 2026-09-20

- Bulk delete and import now report which items failed. Previously a single failing cookie aborted the rest of the batch silently, so you could not tell what had been applied.
- Expanded rows keep what you have typed when the grid refreshes. A live sync used to discard in-progress edits.
- Searching and toggling export options no longer pause the live refresh; only editing inside the grid does.
- Bug fix: closing the side panel in one tab now closes it in the others, matching how opening it already behaved.
