import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

// apps/reader/src/lib/books.js -> repo root is four levels up.
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../../");
const BOOKS_DIR = path.join(REPO_ROOT, "books");

function readMaybe(p) {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return "";
	}
}

/** List all books with frontmatter metadata. */
export function getBooks() {
	if (!fs.existsSync(BOOKS_DIR)) return [];
	return fs
		.readdirSync(BOOKS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => {
			const slug = e.name;
			const fm =
				matter(readMaybe(path.join(BOOKS_DIR, slug, "config.md"))).data || {};
			return {
				slug,
				title: fm.title || slug,
				status: fm.status || "",
				genre: fm.genre || [],
				chapters: getChapters(slug),
			};
		})
		.filter((b) => b.chapters.length > 0)
		.sort((a, b) => a.title.localeCompare(b.title));
}

/** List a book's chapters (metadata only). */
export function getChapters(slug) {
	const dir = path.join(BOOKS_DIR, slug, "chapters");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => /^chapter-\d+\.md$/.test(f))
		.map((f) => {
			const num = Number(f.match(/(\d+)/)[1]);
			const fm = matter(readMaybe(path.join(dir, f))).data || {};
			return {
				number: num,
				slug: String(num),
				title: fm.title || `Chapter ${num}`,
			};
		})
		.sort((a, b) => a.number - b.number);
}

/** Get one chapter's rendered HTML plus neighbours for prev/next. */
export function getChapter(slug, number) {
	const num = Number(number);
	const file = path.join(
		BOOKS_DIR,
		slug,
		"chapters",
		`chapter-${String(num).padStart(2, "0")}.md`,
	);
	const parsed = matter(readMaybe(file));
	const chapters = getChapters(slug);
	const idx = chapters.findIndex((c) => c.number === num);
	return {
		title: parsed.data.title || `Chapter ${num}`,
		html: marked.parse(parsed.content.trim()),
		prev: idx > 0 ? chapters[idx - 1] : null,
		next: idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null,
	};
}

export function getBookMeta(slug) {
	const fm =
		matter(readMaybe(path.join(BOOKS_DIR, slug, "config.md"))).data || {};
	return { slug, title: fm.title || slug, ...fm };
}
