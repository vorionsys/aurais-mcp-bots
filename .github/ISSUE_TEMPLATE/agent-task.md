---
name: Agent Task
about: Claim a scoped unit of work for one agent (human or LLM) to avoid duplicate or competing work
title: "[agent] <short task summary>"
labels: agent-task
assignees: ""
---

## Task

<!-- One sentence: what should change and why. Keep the scope small. -->

## Workspace / area (claim exactly one)

<!-- Name the single package directory or file area this task owns. One agent = one workspace. -->
- Workspace:

- ## Out of scope

- <!-- List files/areas this task must NOT touch, so parallel agents don't collide. -->
- -

- ## Touches shared files?

- <!-- Version bumps, package-lock.json, shared config, or .github/workflows/* must be serialized (done one at a time, never in parallel). -->
- - [ ] No — only the workspace above
  - [ ] - [ ] Yes — shared files involved (coordinate so no other agent runs concurrently)
 
  - [ ] ## Definition of done
 
  - [ ] - [ ] Scope limited to the claimed workspace
  - [ ] - [ ] `typecheck`, `build`, and `test` pass locally for the affected workspace(s)
  - [ ] - [ ] Branch synced with latest `main` before opening / before merge
  - [ ] - [ ] Opened as a small PR (assign this issue to it via "Closes #<n>")
 
  - [ ] ## Coordination checklist (before starting)
 
  - [ ] - [ ] This issue is assigned to me (the claim is now visible to others)
  - [ ] - [ ] No open issue/PR already covers this work
  - [ ] - [ ] No other in-flight branch is editing the same files
  - [ ] 
