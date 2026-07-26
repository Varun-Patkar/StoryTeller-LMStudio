# StoryTeller-LMStudio

A **local, LM Studio-powered story-generation engine** plus a static **Astro reader** you
publish to GitHub Pages.

- 📖 **Live reader:** <https://varun-patkar.github.io/StoryTeller-LMStudio/>
- 💻 **Repository:** <https://github.com/Varun-Patkar/StoryTeller-LMStudio>
- 🚀 **Deployment:** [Deploy reader to GitHub Pages](https://github.com/Varun-Patkar/StoryTeller-LMStudio/actions/workflows/deploy.yml)
  workflow — builds `apps/reader` and publishes to Pages on every push to `main`.

It exists because of one observation: stories written on top of GitHub Copilot always
_read_ as AI. Not because of the story idea — because ~90% of what actually reaches the
model is machine-authored (Copilot's own system prompt, an auto-injected `AGENTS.md`,
generated skills), and only ~10% is your handwritten prompt and reference chapters. LLMs
are biased next-token predictors; drown your 10% in someone else's 90% and the output
regresses to "generic AI narrator" no matter how you word the instructions.

The counter-experiment: hand a local model (a Qwen model, ~60K context) four lines of setup
and a couple of reference chapters, with **no system prompt at all**, and it writes like a
human — because the only style it has to copy is _yours_.

This project is built entirely around that finding.

---

## The golden rule

> **Almost nothing sent to LM Studio to generate the story is AI-generated — every prompt,
> sample, and piece of world memory is yours, written by hand.**

- **You** write the config, the world memory (characters, locations, canon), and every
  prompt (globally, once), by hand.
- **You** provide the writing samples / reference chapters that teach your voice.
- The model authors only the **plan**, the **chapter drafts**, and its own terse **event
  wiki** of divergences from canon — all driven by _your_ prompts.
- There is **no research, no crawling, no knowledge graph, no auto-generated instructions.**

### Two deliberate exceptions

1. **`prompts/system.md`** ships as an AI-drafted, deliberately human-sounding placeholder —
   and so does a fanfiction book's **`canon.md`** (draft canon with an AI, then humanize it).
   Both carry the `<!-- AI-DRAFT: replace before real use -->` marker, and the engine's lint
   flags any file that still has it.
2. **`memory/events/`** is an _agent-managed_ wiki: the model creates and edits terse notes
   on what each chapter changed relative to canon, and reads them back later for continuity.
   This is the one place model-written text feeds future generations — a conscious trade to
   keep long fanfiction consistent on a token budget.

> ⚠️ **REMINDER: rewrite the global `prompts/` files and every book's `canon.md` in your own
> words before generating anything real. AI may write the first draft; a human must edit it
> into something human.**

---

## Two apps, one repo

| App                  | Location      | Runs where        | Deployed?                     |
| -------------------- | ------------- | ----------------- | ----------------------------- |
| **Engine** (creator) | `apps/engine` | your machine only | **No** — never leaves your PC |
| **Reader** (viewer)  | `apps/reader` | static Astro site | **Yes** — GitHub Pages        |

Both read/write the shared `books/` folder. Only the reader is built and published; the
engine (which talks to LM Studio and writes files) stays local.

---

## Layout

Prompts are **author-level and global** (shared by every book); story data is **per-book**.

```
prompts/                     # GLOBAL — shared by all books, written by you
├── system.md                # AI DRAFT — replace, or leave empty to send no system framing
├── plan-prompt.md           # how to generate a plan
├── plan-rewrite-prompt.md   # how to revise a plan from a note
├── chapter-prompt.md        # how to write a chapter
├── rewrite-prompt.md        # how to revise prose from a note
└── samples/*.md             # your reference prose (this teaches your voice)

books/<slug>/
├── config.md                # story settings (YAML frontmatter + notes)
├── canon.md                 # fanfiction only — the full source-canon storyline
├── plan.md                  # LLM — chapter-by-chapter outline
├── summary.md               # running per-chapter summaries
├── memory/
│   ├── characters/*.md       # human-written
│   ├── locations/*.md        # human-written
│   └── events/*.md           # AGENT-managed wiki of divergences from canon
└── chapters/
    └── chapter-01.md ...
```

---

## Workflow

1. **Write your global prompts once** — in the engine's **Prompts** tab (or the repo-root
   `prompts/` folder): system, plan, plan-rewrite, chapter, rewrite, and your samples.
2. **Create a book** and fill in `config.md`. For fanfiction, fill in `canon.md` (draft with
   an AI if you like, then humanize).
3. **Write the memory** — add characters and locations as markdown. (Events are written by
   the agent as it goes.)
4. **Generate the plan** — pick a model; the engine sends _your_ plan-prompt and lets the
   model read config, canon, and memory via tools, then saves `plan.md`. Edit freely, or
   **rewrite by comment** (select part, or none for the whole plan).
5. **Write a chapter** — the engine sends _your_ chapter-prompt + the plan slice; the model
   reads samples/memory/canon on demand, may record divergences to the event wiki, and
   returns a draft. Edit it.
6. **Rewrite by comment** — select any part of a chapter (or none for the whole thing), leave
   a note, and the model revises just that, guided by _your_ rewrite-prompt. Keep or discard.
7. **Publish** — commit; the reader deploys to GitHub Pages.

---

## How generation works (the agentic loop)

Instead of stuffing every memory and sample file into one giant prompt, the engine hands the
model a lean prompt — your instruction + the task input (plan slice / text to revise) + a
**manifest** of what exists — plus a small set of tools. The model then gathers only what it
needs:

- `list_resources` — list config, canon, plan, summary, memory, samples, prior chapters.
- `grep_book` — search across those files (returns `path:line: snippet`).
- `read_book_file` — read a file, optionally a line range.
- `write_event` — create or edit an entry in the story's event wiki (divergences from canon).

The loop (chat + function-calling against LM Studio's `/v1/chat/completions`) executes the
tool calls against your human files and repeats until the model returns final prose — using
far fewer tokens than a full-context dump. A circular **token gauge** on each generation
shows that run's usage against the model's context window, and models are **loaded
just-in-time** at the context length you set per model in **Settings**.

---

## Setup

Prerequisites: **Node 22+**, **LM Studio** running locally with its server enabled
(OpenAI-compatible `/v1`) and a model that **supports tool / function calling**, plus at
least one chat model available.

```powershell
npm install

# Run the local engine (creator) — never deployed
npm run engine

# Run the reader locally
npm run reader

# Build the reader for GitHub Pages
npm run reader:build
```

On first run, open the engine's **Settings** page, point it at your LM Studio server (base
URL, optional API key), **Refresh models**, set each model's context length, and **Save**.
Models load automatically when you generate — there is no manual load step.

---

## Design choices

- **Agentic, not full-context.** Generation is a tool-calling loop: the model reads only the
  slices of memory/canon/samples it needs, keeping token use low. (It needs a model that
  supports function calling.)
- **Global prompts, per-book world.** You write prompts and samples once; each book carries
  only its own config, canon, memory, plan, and chapters.
- **Agent-managed event wiki.** The model keeps a terse, editable record of divergences from
  canon so long fanfiction stays consistent.
- **Just-in-time models.** The chosen model loads on demand at your configured context
  length; no manual load/unload.
- **Engine is local-only.** Only the reader is published, so nothing that talks to your
  machine or LM Studio ever ships.

---

## License

Released under the [MIT License](LICENSE). © 2026 Varun Patkar.
