import fs from "node:fs/promises";
import { SETTINGS_DIR, SETTINGS_FILE } from "./paths.js";

const DEFAULTS = {
	baseUrl: "http://localhost:1234",
	apiKey: "",
	model: "",
	// "completions" gives the purest style mimicry (no chat template / system framing).
	// "chat" is a fallback for models that only behave well with the chat endpoint.
	mode: "completions",
	temperature: 0.9,
	maxTokens: 4096,
};

export async function loadSettings() {
	try {
		const raw = await fs.readFile(SETTINGS_FILE, "utf8");
		return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULTS };
	}
}

export async function saveSettings(patch) {
	const current = await loadSettings();
	const next = { ...current, ...patch };
	await fs.mkdir(SETTINGS_DIR, { recursive: true });
	await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
	return next;
}
