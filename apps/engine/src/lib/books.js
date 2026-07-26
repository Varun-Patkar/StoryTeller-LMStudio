import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { BOOKS_DIR, PROMPTS_DIR, AI_DRAFT_MARKER } from "./paths.js";

const MEMORY_CATEGORIES = ["characters", "events", "locations"];

function bookDir(slug) {
	return path.join(BOOKS_DIR, safeSlug(slug));
}
export function safeSlug(slug) {
	return String(slug)
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function exists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
async function readMaybe(p) {
	try {
		return await fs.readFile(p, "utf8");
	} catch {
		return "";
	}
}
export function stripComments(text) {
	// Remove HTML comments (human notes / the AI-draft marker) so they never reach the model.
	return String(text)
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim();
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export async function listBooks() {
	if (!(await exists(BOOKS_DIR))) return [];
	const entries = await fs.readdir(BOOKS_DIR, { withFileTypes: true });
	const books = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const slug = e.name;
		const configRaw = await readMaybe(path.join(bookDir(slug), "config.md"));
		const fm = configRaw ? matter(configRaw).data : {};
		const chapters = await listChapters(slug);
		books.push({
			slug,
			title: fm.title || slug,
			status: fm.status || "",
			chapters: chapters.length,
		});
	}
	return books.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getBook(slug) {
	slug = safeSlug(slug);
	const dir = bookDir(slug);
	if (!(await exists(dir))) return null;
	const configRaw = await readMaybe(path.join(dir, "config.md"));
	const fm = configRaw ? matter(configRaw).data : {};
	return {
		slug,
		title: fm.title || slug,
		config: fm,
		chapters: await listChapters(slug),
		lint: await promptLint(slug),
	};
}

const TEMPLATE = {
	"config.md": (slug, title) =>
		`---\ntitle: ${title}\nslug: ${slug}\ntype: original\ngenre: []\nthemes: []\npov: third-limited\ntense: past\npacing: \nstatus: draft\n---\n\n# ${title}\n\n## Premise\n\n_Write, in your own words, what this story is about._\n\n## Tone & voice notes\n\n_How it should feel._\n\n## Constraints\n\n_Anything that must stay true._\n`,
	"plan.md": () =>
		`<!-- Generated from YOUR plan-prompt in the engine. -->\n\n_No plan yet._\n`,
	"summary.md": () => `<!-- Running per-chapter summaries. -->\n`,
	"canon.md": () =>
		`${AI_DRAFT_MARKER}\n\n<!--\n  CANON TIMELINE (fanfiction only). Write, in full, what happens across the ENTIRE source\n  canon this story is based on — the events, arcs, and outcomes the model should treat as\n  true unless your plan diverges from them. You may draft this with an AI first, then edit\n  it into your own words. Leave this file empty for original fiction.\n-->\n\n# Canon timeline\n\n_No canon recorded yet._\n`,
};

export async function createBook(rawSlug, title) {
	const slug = safeSlug(rawSlug || title);
	if (!slug) throw new Error("A valid name is required.");
	const dir = bookDir(slug);
	if (await exists(dir))
		throw new Error(`A book named "${slug}" already exists.`);
	for (const category of MEMORY_CATEGORIES) {
		await fs.mkdir(path.join(dir, "memory", category), { recursive: true });
	}
	await fs.mkdir(path.join(dir, "chapters"), { recursive: true });
	for (const [rel, make] of Object.entries(TEMPLATE)) {
		const full = path.join(dir, rel);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, make(slug, title || slug), "utf8");
	}
	return slug;
}

// ---------------------------------------------------------------------------
// Generic file access (scoped to a book, no path traversal)
// ---------------------------------------------------------------------------

function resolveInBook(slug, rel) {
	const dir = bookDir(slug);
	const full = path.resolve(dir, rel);
	if (full !== dir && !full.startsWith(dir + path.sep)) {
		throw new Error("Path escapes the book folder.");
	}
	return full;
}
export async function readBookFile(slug, rel) {
	return readMaybe(resolveInBook(safeSlug(slug), rel));
}
export async function writeBookFile(slug, rel, content) {
	const full = resolveInBook(safeSlug(slug), rel);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, content, "utf8");
	return { ok: true };
}
export async function deleteBookFile(slug, rel) {
	await fs.rm(resolveInBook(safeSlug(slug), rel), { force: true });
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Global prompts (author-level, shared by every book) — repo-root `prompts/`.
// ---------------------------------------------------------------------------

const GLOBAL_PROMPT_TEMPLATE = {
	"system.md": () =>
		`${AI_DRAFT_MARKER}\n\n<!--\n  GLOBAL SYSTEM PROMPT — shared by every book. This ships as an AI-written placeholder;\n  rewrite it in your own words before generating anything real. Many local models sound\n  most human with NO system prompt at all — if so, delete everything here and leave this\n  file empty.\n-->\n\nYou are writing prose for a novel. Continue in the exact voice, rhythm, and vocabulary of the\nwriting samples. Write only the story text.\n`,
	"plan-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for turning a book's config, canon, and memory into a living plan. -->\n\nRead the book's \`config.md\`, its \`canon.md\` (if present), and everything under \`memory/\` with\nthe tools, then write a LIVING plan — not the whole story. Include: a short PREMISE; a few loose\nlines on the OVERARCHING direction (only as far as the idea supports — do not invent a whole plot);\nand NEAR-TERM detail as a beat outline for only the part that is actually known (e.g. the first\narc, up to the next chapter or two). Outline only, no prose. It is fine to leave the later story\nvague; the plan grows as you write. Do not pad it into a full chapter-by-chapter breakdown.\n`,
	"chapter-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for writing a single chapter. -->\n\nWrite this chapter in full, following the plan slice provided. Read the writing samples with the\ntools to match the voice exactly, and check \`memory/\` and \`canon.md\` for any names, facts, or\ncontinuity you need. Keep continuity with \`summary.md\`. Write only the chapter prose.\n`,
	"rewrite-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for revising text from a note. -->\n\nYou are revising existing prose. Apply the note; change only what it asks for and keep everything\nelse intact. Keep the same voice as the writing samples. If the note touches facts, check\n\`memory/\` and \`canon.md\` with the tools. Return only the revised text — no commentary.\n`,
	"plan-rewrite-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for revising the plan from a note. -->\n\nYou are revising an existing chapter-by-chapter plan. Apply the note; change only what it asks for\nand keep the rest of the plan intact. Keep it an outline — no prose. If the note touches facts,\ncheck \`config.md\`, \`memory/\`, and \`canon.md\` with the tools. Keep the chapter numbering consistent.\nReturn only the revised plan text, with no commentary.\n`,
	"samples/sample-01.md": () =>
		`<!-- Human-written reference prose. THIS teaches the model your voice more than any instruction. Replace it. -->\n\n_Paste a passage you wrote yourself here._\n`,
};

function resolveInPrompts(rel) {
	const full = path.resolve(PROMPTS_DIR, rel);
	if (full !== PROMPTS_DIR && !full.startsWith(PROMPTS_DIR + path.sep)) {
		throw new Error("Path escapes the prompts folder.");
	}
	return full;
}
export async function readGlobalPrompt(rel) {
	return readMaybe(resolveInPrompts(rel));
}
export async function writeGlobalPrompt(rel, content) {
	const full = resolveInPrompts(rel);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, content, "utf8");
	return { ok: true };
}
export async function deleteGlobalPrompt(rel) {
	await fs.rm(resolveInPrompts(rel), { force: true });
	return { ok: true };
}
export async function listGlobalSamples() {
	const dir = path.join(PROMPTS_DIR, "samples");
	if (!(await exists(dir))) return [];
	return (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
}
/** Create any missing global prompt files from the template (idempotent). */
export async function ensureGlobalPrompts() {
	for (const [rel, make] of Object.entries(GLOBAL_PROMPT_TEMPLATE)) {
		const full = resolveInPrompts(rel);
		if (!(await exists(full))) {
			await fs.mkdir(path.dirname(full), { recursive: true });
			await fs.writeFile(full, make(), "utf8");
		}
	}
}
/** Flag global prompt files still carrying the AI-draft marker. */
export async function globalPromptLint() {
	const flagged = [];
	if (!(await exists(PROMPTS_DIR))) return flagged;
	async function walk(d) {
		for (const e of await fs.readdir(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) await walk(p);
			else if (e.name.endsWith(".md")) {
				const raw = await readMaybe(p);
				if (raw.includes(AI_DRAFT_MARKER))
					flagged.push(
						"prompts/" +
							path.relative(PROMPTS_DIR, p).replace(/\\/g, "/"),
					);
			}
		}
	}
	await walk(PROMPTS_DIR);
	return flagged;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function listMemory(slug) {
	slug = safeSlug(slug);
	const out = {};
	for (const category of MEMORY_CATEGORIES) {
		const dir = path.join(bookDir(slug), "memory", category);
		let files = [];
		if (await exists(dir)) {
			files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
		}
		out[category] = files;
	}
	return out;
}
export const memoryCategories = () => [...MEMORY_CATEGORIES];

// ---------------------------------------------------------------------------
// Chapters & summary
// ---------------------------------------------------------------------------

export async function listChapters(slug) {
	slug = safeSlug(slug);
	const dir = path.join(bookDir(slug), "chapters");
	if (!(await exists(dir))) return [];
	const files = (await fs.readdir(dir))
		.filter((f) => /^chapter-\d+\.md$/.test(f))
		.sort();
	const out = [];
	for (const f of files) {
		const n = Number(f.match(/(\d+)/)[1]);
		const raw = await readMaybe(path.join(dir, f));
		const fm = raw ? matter(raw).data : {};
		out.push({
			number: n,
			file: `chapters/${f}`,
			title: fm.title || `Chapter ${n}`,
		});
	}
	return out.sort((a, b) => a.number - b.number);
}
export function chapterRel(n) {
	return `chapters/chapter-${String(n).padStart(2, "0")}.md`;
}
export async function appendSummary(slug, n, text) {
	slug = safeSlug(slug);
	const rel = "summary.md";
	const current = await readBookFile(slug, rel);
	const block = `\n## Chapter ${n}\n\n${text.trim()}\n`;
	await writeBookFile(slug, rel, `${current.trimEnd()}\n${block}`);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-book lint — flags the book's own AI-drafted files (currently canon.md).
// Global prompt files are linted separately via globalPromptLint().
// ---------------------------------------------------------------------------

export async function promptLint(slug) {
	slug = safeSlug(slug);
	const flagged = [];
	const canonRaw = await readMaybe(path.join(bookDir(slug), "canon.md"));
	if (canonRaw.includes(AI_DRAFT_MARKER)) flagged.push("canon.md");
	return flagged;
}

// ---------------------------------------------------------------------------
// Context assembly for generation.
// The agentic loop hands the model a lean prompt (the human instruction + a manifest of
// what exists) and lets it pull specifics with tools. Everything the model can read is
// human-authored; the only text the engine adds is the neutral structural glue below.
// ---------------------------------------------------------------------------

export async function getSystemPrompt() {
	return stripComments(await readGlobalPrompt("system.md"));
}

/**
 * Raw read router used by the agentic tools: a "prompts/…" path resolves to the global
 * prompts folder, anything else to the given book. Returns raw text (comments intact).
 */
export async function readResourceRaw(slug, rel) {
	if (rel === "prompts" || rel.startsWith("prompts/"))
		return readGlobalPrompt(rel.replace(/^prompts\/?/, ""));
	return readBookFile(slug, rel);
}

function section(label, body) {
	return body && body.trim() ? `## ${label}\n\n${body.trim()}` : "";
}

/**
 * Neutral resource block appended to every agentic prompt: the manifest of what exists
 * plus minimal, structural guidance on how to pull it in. No creative instruction — that
 * always comes from the human prompt files.
 */
function resourceBlock(manifest) {
	return [
		"## Available resources",
		manifest,
		"Read the resources you need with the tools (list_resources, grep_book, read_book_file) before writing. Read the writing samples to match the voice. For fanfiction, `canon.md` is the full source storyline — treat it as true. `memory/events` is your own event wiki of DIVERGENCES from canon (what this story changed); read it to stay consistent, and whenever this text changes something away from canon, create or update an entry with the write_event tool (read an entry first if you are editing it). Keep anything you record terse and plainly human — we are on a token budget. Do not contradict `canon.md`, `memory/`, or facts you have read. Your final reply must contain only the requested text, with no tool commentary.",
	].join("\n\n");
}

/** Lean prompt for generating the plan: human plan-prompt + resource manifest. */
export async function buildPlanAgentPrompt(slug, manifest) {
	const instruction = stripComments(await readGlobalPrompt("plan-prompt.md"));
	return [section("Task", instruction), resourceBlock(manifest)]
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Lean prompt for writing chapter n: human chapter-prompt + the whole (living) plan + manifest.
 * The plan is intentionally NOT sliced per chapter — it is a short premise + overarching
 * direction + near-term detail, and the model uses the running summary for "where we are".
 * `planOverride` lets the chapter page send an edited plan for this one generation.
 */
export async function buildChapterAgentPrompt(slug, n, planOverride, manifest) {
	slug = safeSlug(slug);
	const planText = stripComments(await readBookFile(slug, "plan.md"));
	const plan =
		planOverride != null && planOverride !== "" ? planOverride : planText;
	const instruction = stripComments(await readGlobalPrompt("chapter-prompt.md"));
	return [
		section("Task", instruction),
		section(`Plan (you are writing chapter ${n})`, plan),
		resourceBlock(manifest),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Lean prompt for a comment-driven rewrite: human rewrite-prompt + target text + manifest. */
export async function buildRewriteAgentPrompt(
	slug,
	{ fullText, selection, comment },
	manifest,
) {
	slug = safeSlug(slug);
	const instruction = stripComments(await readGlobalPrompt("rewrite-prompt.md"));
	const target = selection && selection.trim() ? selection : fullText;
	const context =
		selection && selection.trim()
			? section("Surrounding chapter (for context, do not rewrite)", fullText)
			: "";
	return [
		section("Task", instruction),
		context,
		section("Text to revise", target),
		section("Note", comment),
		resourceBlock(manifest),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Lean prompt for a comment-driven plan rewrite: human plan-rewrite-prompt + target + manifest. */
export async function buildPlanRewriteAgentPrompt(
	slug,
	{ fullText, selection, comment },
	manifest,
) {
	const instruction = stripComments(
		await readGlobalPrompt("plan-rewrite-prompt.md"),
	);
	const target = selection && selection.trim() ? selection : fullText;
	const context =
		selection && selection.trim()
			? section("Surrounding plan (for context, do not rewrite)", fullText)
			: "";
	return [
		section("Task", instruction),
		context,
		section("Plan to revise", target),
		section("Note", comment),
		resourceBlock(manifest),
	]
		.filter(Boolean)
		.join("\n\n");
}
