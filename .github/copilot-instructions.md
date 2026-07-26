# Copilot instructions — StoryTeller-LMStudio

## What this is

A local, LM Studio-powered story-generation engine plus a static Astro reader. Monorepo,
npm workspaces. The apps share the `books/` folder; the engine also reads author-level
global prompts from the repo-root `prompts/` folder.

| App              | Path          | Runtime                                     | Deployed                   |
| ---------------- | ------------- | ------------------------------------------- | -------------------------- |
| Engine (creator) | `apps/engine` | Astro **server** (Node adapter), local only | **Never**                  |
| Reader (viewer)  | `apps/reader` | Astro **static**                            | GitHub Pages (reader only) |

## The golden rule (do not break)

**Almost nothing sent to LM Studio to generate the story is AI-generated.** The context is
human-authored: per-book `config.md`, `canon.md`, `memory/characters` + `memory/locations`,
and the **global** `prompts/` folder (system, plan/plan-rewrite/chapter/rewrite instructions,
and writing samples). The model authors only `plan.md`, chapter drafts, and its own terse
`memory/events/` wiki (see below).

- Two seeded AI-draft exceptions carry the marker `<!-- AI-DRAFT: replace before real use -->`:
  the global `prompts/system.md` and a book's `canon.md`. `globalPromptLint()` flags prompt
  files and `promptLint(slug)` flags `canon.md`. Never remove the lint or the marker mechanism.
- **`memory/events/` is agent-managed**: the model creates/edits terse divergence notes via
  the `write_event` tool and reads them back later. This is the one intentional place where
  model-written text feeds future generations — a deliberate trade for long-fic consistency.
- Before content reaches the model, `stripComments()` removes all HTML comments so human notes
  never leak. Keep prompt-assembly glue to neutral structural labels; the only engine-added
  instruction is the minimal tool-usage note in `resourceBlock()`.

## How generation works (agentic)

Generation is a **chat + function-calling loop** (`generateAgentic()` in `lmstudio.js`) against
LM Studio's `/v1/chat/completions`. The model gets a lean prompt (human instruction + task
input + a resource **manifest**) plus tools, and pulls what it needs itself:

- `list_resources`, `grep_book`, `read_book_file` — read-only, book-scoped (a `prompts/…` path
  routes to the global folder via `readResourceRaw`).
- `write_event` — create/edit an entry in the book's `memory/events` wiki.

Tools live in `apps/engine/src/lib/tools.js`. Lean prompt builders (`buildPlanAgentPrompt`,
`buildChapterAgentPrompt`, `buildRewriteAgentPrompt`, `buildPlanRewriteAgentPrompt`) live in
`books.js`. `/api/generate` wires them together, JIT-loads the chosen model at its configured
context length, and returns `{ text, usage, contextMax }` (the token gauge fills from `usage`).

## Where things live

- Prompt/context assembly, book file I/O, and global-prompt helpers: `apps/engine/src/lib/books.js`.
- Agentic tools (manifest, grep, read, write_event): `apps/engine/src/lib/tools.js`.
- LM Studio client (model list with `maxContext`, JIT `ensureLoaded`, `generateAgentic`) via
  `@lmstudio/sdk` + OpenAI-compatible REST: `apps/engine/src/lib/lmstudio.js`.
- Repo-root discovery + `BOOKS_DIR` / `PROMPTS_DIR` / settings paths: `apps/engine/src/lib/paths.js`.
  Reader has its own `apps/reader/src/lib/books.js`.
- Engine API routes: `apps/engine/src/pages/api/*.js` (all `export const prerender = false`);
  global prompts are edited via `/api/prompt`.
- Engine UI: `apps/engine/src/pages/**` (`.astro`, vanilla JS in `<script>` talking to the API;
  shared client scripts in `apps/engine/public/*.js`). Reader pages use `getStaticPaths()`.

## Layout

```
prompts/                       # GLOBAL, human-authored, shared by every book
  system.md  plan-prompt.md  plan-rewrite-prompt.md
  chapter-prompt.md  rewrite-prompt.md  samples/*.md

books/<slug>/
  config.md  canon.md  plan.md  summary.md
  memory/{characters,locations}/*.md   # human-written
  memory/events/*.md                   # AGENT-managed divergence wiki
  chapters/chapter-NN.md
```

## Conventions

- ES modules everywhere (`"type": "module"`). Node 22+ (Astro 7).
- Generation requires a model that **supports tool/function calling**.
- API responses are JSON; errors as `{ error }` with a non-200 status.
- Book file access goes through `resolveInBook()`; global prompts through `resolveInPrompts()` —
  never build these paths by hand (path-traversal guards).
- Chapter files are `chapter-NN.md` (zero-padded) with `title` / `number` frontmatter.

## Commands

```
npm install
npm run engine        # local creator on http://localhost:4321 (astro dev)
npm run reader        # reader dev
npm run reader:build  # static build for Pages -> apps/reader/dist
npm run build --workspace apps/engine   # verify the engine compiles
```

## Deploying

Only the reader deploys, via `.github/workflows/deploy.yml`. The engine must never be built
into or published to Pages. If the reader's site/base is wrong, fix it in
`apps/reader/astro.config.mjs` (`PAGES_BASE` env overrides `base`).
