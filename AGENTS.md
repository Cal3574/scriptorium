<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Finishing an /implement

At the end of every `/implement`, after the code and automated tests are done, ALWAYS end your response with a **"Manual testing"** section written for the developer.

It must:

- List the exact commands to get the affected surface running locally (e.g. `pnpm nx serve api`, `pnpm nx serve client`, `docker compose up -d`, any required env or `PROVIDER_MODE`).
- Give concrete, ordered steps to exercise the change by hand - what to click, what URL to open, what payload to send, what to type.
- State the expected observable result of each step (UI state, HTTP status, DB row, log line, queue job) so the dev knows what "working" looks like.
- Call out anything that cannot be verified end-to-end yet (missing worker, unimplemented pipeline, stubbed provider) and what the dev should expect to see instead.
- Note any teardown or cleanup needed after testing.

Keep it to the affected area only - do not dump a generic app walkthrough.
