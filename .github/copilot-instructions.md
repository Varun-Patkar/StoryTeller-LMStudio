# Copilot instructions — StoryTeller-LMStudio

## What this is
A local, LM Studio-powered story-generation engine plus a static Astro reader. Monorepo,
npm workspaces. Two apps share the `books/` folder.

| App | Path | Runtime | Deployed |
| --- | --- | --- | --- |
| Engine (creator) | `apps/engine` | Astro **server** (Node adapter), local only | **Never** |
| Reader (viewer) | `apps/reader` | Astro **static** | GitHub Pages (reader only) |

## The golden rule (do not break)
**Nothing AI-generated may be sent to LM Studio to generate the story.** All context is
human-authored: `config.md`, everything under `memory/`, and every file under `prompts/`
(including writing samples). The model produces only `plan.md` (from the human plan-prompt)
and chapter drafts (from the human chapter-prompt + a slice of that plan).

- The one seeded exception is `prompts/system.md`, which ships as an AI placeholder carrying
  the marker `<!-- AI-DRAFT: replace before real use -->`. `promptLint()` flags any prompt
  file that still contains it. Never remove the lint or the marker mechanism.
- Before content reaches the model, `stripComments()` removes all HTML comments so human
  notes never leak. Keep prompt-assembly glue to neutral structural labels only — never add
  instructions of your own into what is sent.

## Where things live
- Prompt/context assembly and all book file I/O: `apps/engine/src/lib/books.js`.
- LM Studio client (model list/load/unload via `@lmstudio/sdk`; generation via OpenAI-compatible
  `/v1/completions` — preferred — or `/v1/chat/completions`): `apps/engine/src/lib/lmstudio.js`.
- Repo-root discovery (walks up to the folder containing both `books/` and `apps/`):
  `apps/engine/src/lib/paths.js`. Reader has its own `apps/reader/src/lib/books.js`.
- Engine API routes: `apps/engine/src/pages/api/*.js` (all `export const prerender = false`).
- Engine UI: `apps/engine/src/pages/**` (`.astro`, vanilla JS in `<script>` talking to the API).
- Reader pages use `getStaticPaths()` and read `books/` at build time.

## Book layout
```
books/<slug>/
  config.md          plan.md          summary.md
  prompts/system.md  prompts/plan-prompt.md  prompts/chapter-prompt.md
  prompts/rewrite-prompt.md  prompts/samples/*.md
  memory/{characters,events,locations}/*.md
  chapters/chapter-NN.md
```

## Conventions
- ES modules everywhere (`"type": "module"`). Node 18.17+.
- API responses are JSON; errors as `{ error }` with a non-200 status.
- Book file access goes through `resolveInBook()` — never build book paths by hand (path-traversal guard).
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
