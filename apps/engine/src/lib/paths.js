import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

// Find the repo root by walking up from this module (works in dev) and from the process cwd
// (works when the built server is bundled to a different depth). The root is the first
// ancestor that contains both `books` and `apps`.
function findRoot(start) {
	let dir = start;
	for (let i = 0; i < 12; i++) {
		if (
			fs.existsSync(path.join(dir, "books")) &&
			fs.existsSync(path.join(dir, "apps"))
		)
			return dir;
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT =
	findRoot(here) ||
	findRoot(process.cwd()) ||
	path.resolve(here, "../../../../");
export const BOOKS_DIR = path.join(REPO_ROOT, "books");
export const SETTINGS_DIR = path.join(REPO_ROOT, ".storyteller");
export const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

// The marker that flags an unedited AI-drafted prompt file.
export const AI_DRAFT_MARKER = "<!-- AI-DRAFT: replace before real use -->";
