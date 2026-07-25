/**
 * tools.js — read-only, book-scoped tools for the agentic generation loop.
 *
 * The model is given a lean prompt and these tools instead of a giant context dump.
 * It can list the human-authored resources, search across them, and read exactly the
 * lines it needs. Everything here is human-authored content (the golden rule holds):
 * the tools only expose files inside the book folder, with HTML comments stripped so
 * human notes never leak, and a path-traversal guard on every read.
 */
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { BOOKS_DIR, PROMPTS_DIR } from "./paths.js";
import { safeSlug, readResourceRaw, stripComments } from "./books.js";

// Caps to keep tool results small (this is what actually reaches the model).
const MAX_GREP_MATCHES = 60;
const MAX_READ_LINES = 500;
const MAX_READ_CHARS = 20000;
const SNIPPET_LEN = 160;

function bookDir(slug) {
	return path.join(BOOKS_DIR, safeSlug(slug));
}

/**
 * Recursively collect every markdown file available to a book: the book's own files plus
 * the author-level global prompts (returned with a "prompts/…" prefix). Paths are posix.
 */
async function collectFiles(slug) {
	const out = [];
	async function walk(base, prefix) {
		async function inner(abs) {
			let entries = [];
			try {
				entries = await fs.readdir(abs, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = path.join(abs, e.name);
				if (e.isDirectory()) await inner(full);
				else if (e.name.endsWith(".md")) {
					const rel = path.relative(base, full).split(path.sep).join("/");
					out.push(prefix + rel);
				}
			}
		}
		await inner(base);
	}
	await walk(bookDir(slug), "");
	await walk(PROMPTS_DIR, "prompts/");
	return out.sort();
}

/** The canonical view the model sees for a file: comments stripped, trimmed. */
async function readableView(slug, rel) {
	return stripComments(await readResourceRaw(slug, rel));
}

/** Best-effort human-readable title for a resource file. */
function titleOf(rel, raw) {
	try {
		const fm = matter(raw).data;
		if (fm && fm.title) return String(fm.title);
	} catch {
		/* not frontmatter */
	}
	const heading = String(raw).match(/^\s*#\s+(.+)$/m);
	if (heading) return heading[1].trim();
	return rel.split("/").pop().replace(/\.md$/, "");
}

/**
 * Build a compact manifest of the resources available for a story. This is what the
 * model is shown up front ("these exist") and what `list_resources` returns.
 */
export async function buildManifest(slug) {
	slug = safeSlug(slug);
	const files = await collectFiles(slug);
	const groups = {
		Story: [],
		Canon: [],
		Memory: [],
		"Writing samples": [],
		Chapters: [],
	};
	for (const rel of files) {
		const raw = await readResourceRaw(slug, rel);
		const body = stripComments(raw);
		if (!body) continue; // skip empty / comment-only stubs
		const title = titleOf(rel, raw);
		const lines = body.split(/\r?\n/).length;
		const entry = `- ${rel} — ${title} (${lines} lines)`;
		if (rel === "canon.md") groups.Canon.push(entry);
		else if (rel.startsWith("memory/")) groups.Memory.push(entry);
		else if (rel.startsWith("prompts/samples/"))
			groups["Writing samples"].push(entry);
		else if (rel.startsWith("chapters/")) groups.Chapters.push(entry);
		else if (["config.md", "plan.md", "summary.md"].includes(rel))
			groups.Story.push(entry);
	}
	const sections = [];
	for (const [name, entries] of Object.entries(groups)) {
		if (entries.length) sections.push(`### ${name}\n${entries.join("\n")}`);
	}
	return sections.length
		? sections.join("\n\n")
		: "(no resources yet — this story has no populated files)";
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Search across a story's files. `query` is treated as a regex; if it doesn't compile,
 * it falls back to a literal search. `sub` optionally restricts to a path prefix.
 */
export async function grepBook(slug, query, sub = "") {
	slug = safeSlug(slug);
	if (!query || !String(query).trim()) return "Provide a non-empty query.";
	let re;
	try {
		re = new RegExp(query, "i");
	} catch {
		re = new RegExp(escapeRegex(query), "i");
	}
	const files = await collectFiles(slug);
	const matches = [];
	for (const rel of files) {
		if (sub && !rel.startsWith(sub.replace(/^\/+|\/+$/g, ""))) continue;
		const body = await readableView(slug, rel);
		if (!body) continue;
		const lines = body.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (re.test(lines[i])) {
				const snip = lines[i].trim().slice(0, SNIPPET_LEN);
				matches.push(`${rel}:${i + 1}: ${snip}`);
				if (matches.length >= MAX_GREP_MATCHES) break;
			}
		}
		if (matches.length >= MAX_GREP_MATCHES) break;
	}
	if (!matches.length) return `No matches for "${query}".`;
	const capped =
		matches.length >= MAX_GREP_MATCHES
			? `\n… (truncated at ${MAX_GREP_MATCHES} matches)`
			: "";
	return matches.join("\n") + capped;
}

/**
 * Read a resource file (comments stripped), optionally limited to a 1-based inclusive
 * line range. Output is line-numbered so ranges line up with grep_book results.
 */
export async function readBookLines(slug, rel, startLine, endLine) {
	slug = safeSlug(slug);
	if (!rel) return "Provide a file path.";
	let body;
	try {
		body = await readableView(slug, rel);
	} catch {
		return `Cannot read "${rel}" (outside the book or unreadable).`;
	}
	if (!body) return `"${rel}" is empty or does not exist.`;
	const lines = body.split(/\r?\n/);
	let start = Number.isFinite(startLine) ? Math.max(1, startLine) : 1;
	let end = Number.isFinite(endLine) ? Math.min(lines.length, endLine) : lines.length;
	if (end < start) end = start;
	if (end - start + 1 > MAX_READ_LINES) end = start + MAX_READ_LINES - 1;
	const width = String(end).length;
	let chars = 0;
	const out = [];
	for (let i = start; i <= end && i <= lines.length; i++) {
		const line = `${String(i).padStart(width)}| ${lines[i - 1]}`;
		chars += line.length + 1;
		if (chars > MAX_READ_CHARS) {
			out.push("… (truncated — read a smaller range)");
			break;
		}
		out.push(line);
	}
	return out.join("\n");
}

/** OpenAI-compatible tool (function-calling) schema for the agentic loop. */
export function getToolDefinitions() {
	return [
		{
			type: "function",
			function: {
				name: "list_resources",
				description:
					"List the human-authored resources available for this story (config, canon, plan, running summary, character/event/location memory, writing samples, and prior chapters), with their paths and titles. Call this first to see what exists, then read only what you need.",
				parameters: { type: "object", properties: {} },
			},
		},
		{
			type: "function",
			function: {
				name: "grep_book",
				description:
					"Search across the story's resource files for a word, name, or regular expression. Returns matching file paths with 1-based line numbers and a snippet of each line.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Text or regular expression to search for.",
						},
						path: {
							type: "string",
							description:
								"Optional path prefix to limit the search, e.g. 'memory/characters' or 'canon.md'.",
						},
					},
					required: ["query"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "read_book_file",
				description:
					"Read a resource file's contents (HTML comments removed). Optionally limit to a 1-based inclusive line range. Line numbers match grep_book, so you can read just the span you need.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Relative path, e.g. 'memory/characters/mara.md'.",
						},
						start_line: {
							type: "number",
							description: "First line to read (1-based). Omit to start at 1.",
						},
						end_line: {
							type: "number",
							description: "Last line to read (1-based, inclusive). Omit to read to the end.",
						},
					},
					required: ["path"],
				},
			},
		},
	];
}

/**
 * Execute a tool call by name against a book. `args` is the parsed arguments object
 * from the model. Always returns a string (never throws) so the loop can continue.
 */
export async function executeTool(slug, name, args = {}) {
	try {
		if (name === "list_resources") return await buildManifest(slug);
		if (name === "grep_book")
			return await grepBook(slug, args.query, args.path || "");
		if (name === "read_book_file")
			return await readBookLines(
				slug,
				args.path,
				Number(args.start_line),
				Number(args.end_line),
			);
		return `Unknown tool: ${name}`;
	} catch (err) {
		return `Tool "${name}" failed: ${err?.message || err}`;
	}
}
