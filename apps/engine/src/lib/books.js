import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { BOOKS_DIR, AI_DRAFT_MARKER } from "./paths.js";

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
	"prompts/system.md": () =>
		`${AI_DRAFT_MARKER}\n\n<!--\n  SYSTEM PROMPT. This ships as an AI-written placeholder — rewrite it in your own words\n  before generating anything real. Many models sound most human with NO system prompt at\n  all; if so, delete everything here and leave the file empty.\n-->\n\nYou are writing prose for a novel. Continue in the exact voice, rhythm, and vocabulary of the\nwriting samples you are given. Write only the story text.\n`,
	"prompts/plan-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for turning config + memory into a plan. -->\n\nUsing the config, characters, events, and locations above, write a chapter-by-chapter plan.\nFor each chapter give a short title, the key beats, who is present, and what changes by the end.\nOutline only — no prose. Number the chapters.\n`,
	"prompts/chapter-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for writing a single chapter. -->\n\nWrite this chapter in full, following the plan entry above and staying grounded in the\ncharacters, events, and locations. Match the voice of the writing samples exactly. Keep\ncontinuity with the running summary. Write only the chapter prose.\n`,
	"prompts/rewrite-prompt.md": () =>
		`<!-- Human-written. YOUR instruction for revising text from a note. -->\n\nYou are revising existing prose. Apply the note; change only what it asks for and keep\neverything else intact. Keep the same voice. Return only the revised text — no commentary.\n`,
	"prompts/samples/sample-01.md": () =>
		`<!-- Human-written reference prose. THIS teaches the model your voice. Replace it. -->\n\n_Paste a passage you wrote yourself here._\n`,
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
	await fs.mkdir(path.join(dir, "prompts", "samples"), { recursive: true });
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
// Prompt lint — flags prompt files still carrying the AI-draft marker.
// ---------------------------------------------------------------------------

export async function promptLint(slug) {
	slug = safeSlug(slug);
	const flagged = [];
	const dir = path.join(bookDir(slug), "prompts");
	if (!(await exists(dir))) return flagged;
	async function walk(d) {
		for (const e of await fs.readdir(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) await walk(p);
			else if (e.name.endsWith(".md")) {
				const raw = await readMaybe(p);
				if (raw.includes(AI_DRAFT_MARKER))
					flagged.push(path.relative(bookDir(slug), p).replace(/\\/g, "/"));
			}
		}
	}
	await walk(dir);
	return flagged;
}

// ---------------------------------------------------------------------------
// Context assembly for generation.
// Everything here is human-authored; the only text the engine adds is the neutral
// section labels below (structural glue, no instructions).
// ---------------------------------------------------------------------------

async function gatherMemory(slug) {
	slug = safeSlug(slug);
	const parts = [];
	const mem = await listMemory(slug);
	for (const category of MEMORY_CATEGORIES) {
		for (const file of mem[category]) {
			const body = stripComments(
				await readBookFile(slug, `memory/${category}/${file}`),
			);
			if (body) parts.push(body);
		}
	}
	return parts.join("\n\n");
}
async function gatherSamples(slug) {
	slug = safeSlug(slug);
	const dir = path.join(bookDir(slug), "prompts", "samples");
	if (!(await exists(dir))) return "";
	const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
	const parts = [];
	for (const f of files) {
		const body = stripComments(
			await readBookFile(slug, `prompts/samples/${f}`),
		);
		if (body) parts.push(body);
	}
	return parts.join("\n\n");
}
export async function getSystemPrompt(slug) {
	return stripComments(await readBookFile(safeSlug(slug), "prompts/system.md"));
}

function section(label, body) {
	return body && body.trim() ? `## ${label}\n\n${body.trim()}` : "";
}

/** Build the user prompt for generating the plan (all human-authored). */
export async function buildPlanPrompt(slug) {
	slug = safeSlug(slug);
	const config = stripComments(await readBookFile(slug, "config.md"));
	const memory = await gatherMemory(slug);
	const samples = await gatherSamples(slug);
	const instruction = stripComments(
		await readBookFile(slug, "prompts/plan-prompt.md"),
	);
	return [
		section("Story config", config),
		section("Characters, events, locations", memory),
		section("Writing samples", samples),
		section("Task", instruction),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Split a plan into per-chapter blocks and return the slice for chapter n. */
export function planSlice(planText, n) {
	const lines = String(planText).split(/\r?\n/);
	const starts = [];
	const re = /^\s{0,3}(?:#{1,6}\s*)?(?:chapter\s*)?0*(\d+)\b[:.\-\s)]/i;
	lines.forEach((line, i) => {
		const m = line.match(re);
		if (m) starts.push({ num: Number(m[1]), i });
	});
	const start = starts.find((s) => s.num === Number(n));
	if (!start) return String(planText).trim(); // fall back to the whole plan
	const nextIdx = starts
		.filter((s) => s.i > start.i)
		.map((s) => s.i)
		.sort((a, b) => a - b)[0];
	return lines
		.slice(start.i, nextIdx ?? lines.length)
		.join("\n")
		.trim();
}

/** Build the user prompt for writing chapter n (all human-authored). */
export async function buildChapterPrompt(slug, n, planSliceOverride) {
	slug = safeSlug(slug);
	const config = stripComments(await readBookFile(slug, "config.md"));
	const memory = await gatherMemory(slug);
	const samples = await gatherSamples(slug);
	const summary = stripComments(await readBookFile(slug, "summary.md"));
	const planText = stripComments(await readBookFile(slug, "plan.md"));
	const slice =
		planSliceOverride != null && planSliceOverride !== ""
			? planSliceOverride
			: planSlice(planText, n);
	const instruction = stripComments(
		await readBookFile(slug, "prompts/chapter-prompt.md"),
	);
	return [
		section("Story config", config),
		section("Characters, events, locations", memory),
		section("Writing samples", samples),
		section("Summary so far", summary),
		section(`Plan for chapter ${n}`, slice),
		section("Task", instruction),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Build the user prompt for a rewrite driven by a human comment. */
export async function buildRewritePrompt(
	slug,
	{ fullText, selection, comment },
) {
	slug = safeSlug(slug);
	const memory = await gatherMemory(slug);
	const samples = await gatherSamples(slug);
	const instruction = stripComments(
		await readBookFile(slug, "prompts/rewrite-prompt.md"),
	);
	const target = selection && selection.trim() ? selection : fullText;
	const context =
		selection && selection.trim()
			? section("Surrounding chapter (for context, do not rewrite)", fullText)
			: "";
	return [
		section("Characters, events, locations", memory),
		section("Writing samples", samples),
		context,
		section("Text to revise", target),
		section("Note", comment),
		section("Task", instruction),
	]
		.filter(Boolean)
		.join("\n\n");
}
