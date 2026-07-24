import { loadSettings } from "../../lib/settings.js";
import { generate, ensureLoaded } from "../../lib/lmstudio.js";
import {
	getSystemPrompt,
	buildPlanPrompt,
	buildChapterPrompt,
	buildRewritePrompt,
} from "../../lib/books.js";

export const prerender = false;

export async function POST({ request }) {
	try {
		const body = await request.json();
		const { slug, task } = body;
		if (!slug || !task)
			return json({ error: "slug and task are required" }, 400);

		const settings = await loadSettings();
		const system = await getSystemPrompt(slug);

		let prompt;
		if (task === "plan") {
			prompt = await buildPlanPrompt(slug);
		} else if (task === "chapter") {
			prompt = await buildChapterPrompt(slug, body.n, body.planSlice);
		} else if (task === "rewrite") {
			prompt = await buildRewritePrompt(slug, {
				fullText: body.fullText || "",
				selection: body.selection || "",
				comment: body.comment || "",
			});
		} else {
			return json({ error: "Unknown task" }, 400);
		}

		// The model chosen for this generation (falls back to the saved default).
		const model = body.model || settings.model;
		// Load it just-in-time with its configured context length, if not already loaded.
		const contextLength = settings.contextLengths?.[model];
		await ensureLoaded(settings, model, contextLength);

		const text = await generate(settings, { prompt, system, model });
		return json({ text, prompt });
	} catch (err) {
		return json({ error: err.message }, 502);
	}
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
