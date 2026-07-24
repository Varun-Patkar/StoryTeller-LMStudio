# StoryTeller-LMStudio

A **local, LM Studio-powered story-generation engine** plus a static **Astro reader** you
publish to GitHub Pages.

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

> **Not one iota of what is sent to LM Studio to generate the story may be AI-generated.**

- **You** write the config, the world memory (characters, events, locations, …), and every
  prompt, by hand.
- **You** provide the writing samples / reference chapters.
- The model produces only two things, and both are driven purely by _your_ prompts:
  1. the **plan** (from your handwritten plan-prompt), and
  2. the **chapter drafts** (from your handwritten chapter-prompt + the relevant slice of
     that plan).
- There is **no research, no crawling, no knowledge graph, no auto-generated instructions.**

### The one exception (read this)

Each story ships with `prompts/system.md`. To give you a running start it contains an
**AI-drafted, deliberately human-sounding first draft**. That is a placeholder, not the
product.

> ⚠️ **REMINDER TO SELF (Varun): before you generate anything real, rewrite every file in
> `books/<slug>/prompts/` and `books/<slug>/prompts/samples/` in your own words and your own
> hand. AI may write the first draft; a human must edit it into something human. The engine
> flags any prompt file that still carries the `<!-- AI-DRAFT: replace before real use -->`
> marker so you can't forget.**

---

## Two apps, one repo

| App                  | Location      | Runs where        | Deployed?                     |
| -------------------- | ------------- | ----------------- | ----------------------------- |
| **Engine** (creator) | `apps/engine` | your machine only | **No** — never leaves your PC |
| **Reader** (viewer)  | `apps/reader` | static Astro site | **Yes** — GitHub Pages        |

Both read/write the shared `books/` folder. Only the reader is built and published; the
engine (which talks to LM Studio and writes files) stays local.

---

## Book layout

```
books/<slug>/
├── config.md              # human — story settings (YAML frontmatter + notes)
├── plan.md                # LLM — generated from YOUR plan-prompt (the only AI artifact)
├── summary.md             # running per-chapter summaries
├── prompts/               # human-owned
│   ├── system.md          # AI DRAFT — replace with your own writing
│   ├── plan-prompt.md     # your instructions for generating the plan
│   ├── chapter-prompt.md  # your instructions for writing a chapter
│   ├── rewrite-prompt.md  # your instructions for rewriting via comments
│   └── samples/           # your reference prose / chapters
├── memory/                # human-written "memory" the model is grounded in
│   ├── characters/*.md
│   ├── events/*.md
│   └── locations/*.md
└── chapters/
    └── chapter-01.md ...
```

---

## Workflow

1. **Create a book** and fill in `config.md` (type, fandom/setting, genre, themes, pacing,
   divergence point, …).
2. **Write the memory** — add characters, events, locations as markdown.
3. **Write the prompts** — replace the AI drafts in `prompts/` with your own words; add
   writing samples.
4. **Generate the plan** — the engine sends _your_ plan-prompt + config + memory + samples to
   LM Studio and saves `plan.md`. Edit it freely.
5. **Write a chapter** — pick a chapter; the engine sends _your_ chapter-prompt + the relevant
   plan slice + memory + samples + prior summary. Draft appears; you edit it.
6. **Rewrite by comment** — select any part of the chapter (or none, for the whole thing),
   leave a comment, and the engine asks the model to revise just that, guided by _your_
   rewrite-prompt. Keep or discard.
7. **Publish** — commit; the reader deploys to GitHub Pages.

---

## Setup

Prerequisites: **Node 18.17+**, **LM Studio** running locally with its server enabled
(OpenAI-compatible `/v1`), and at least one chat model available.

```powershell
npm install

# Run the local engine (creator) — never deployed
npm run engine

# Run the reader locally
npm run reader

# Build the reader for GitHub Pages
npm run reader:build
```

On first run, open the engine's **Settings** page and point it at your LM Studio server
(base URL, optional API key), then load a model.

---

## Design choices

- **Completions, not chat.** Generation uses LM Studio's `/v1/completions` for the purest
  style-mimicry (matches the "no system prompt" finding). A chat fallback exists.
- **No graph, no research.** Memory is plain human-written markdown. Nothing is fetched.
- **Engine is local-only.** Only the reader is published, so nothing that talks to your
  machine or LM Studio ever ships.
