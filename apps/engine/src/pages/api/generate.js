import { loadSettings } from "../../lib/settings.js";
import { generateAgentic, ensureLoaded } from "../../lib/lmstudio.js";
import {
	getSystemPrompt,
	buildPlanAgentPrompt,
	buildChapterAgentPrompt,
	buildRewriteAgentPrompt,
	buildPlanRewriteAgentPrompt,
} from "../../lib/books.js";
import {
	getToolDefinitions,
	buildManifest,
	executeTool,
} from "../../lib/tools.js";

export const prerender = false;

export async function POST({ request }) {
	try {
		const body = await request.json();
		const { slug, task } = body;
		if (!slug || !task)
			return json({ error: "slug and task are required" }, 400);

		const settings = await loadSettings();
		const system = await getSystemPrompt();
		const manifest = await buildManifest(slug);

		// Build the lean user prompt (human instruction + resource manifest) per task.
		let userPrompt;
		if (task === "plan") {
			userPrompt = await buildPlanAgentPrompt(slug, manifest);
		} else if (task === "chapter") {
			userPrompt = await buildChapterAgentPrompt(
				slug,
				body.n,
				body.planSlice,
				manifest,
			);
		} else if (task === "rewrite") {
			userPrompt = await buildRewriteAgentPrompt(
				slug,
				{
					fullText: body.fullText || "",
					selection: body.selection || "",
					comment: body.comment || "",
				},
				manifest,
			);
		} else if (task === "plan-rewrite") {
			userPrompt = await buildPlanRewriteAgentPrompt(
				slug,
				{
					fullText: body.fullText || "",
					selection: body.selection || "",
					comment: body.comment || "",
				},
				manifest,
			);
		} else {
			return json({ error: "Unknown task" }, 400);
		}

		// The model chosen for this generation (falls back to the saved default).
		const model = body.model || settings.model;
		const contextLength = settings.contextLengths?.[model];
		await ensureLoaded(settings, model, contextLength);

		const messages = [];
		if (system && system.trim())
			messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: userPrompt });

		const { text, steps } = await generateAgentic(settings, {
			messages,
			tools: getToolDefinitions(),
			runTool: (name, args) => executeTool(slug, name, args),
			model,
			maxSteps: Number(settings.agentMaxSteps) || 8,
		});
		return json({ text, steps });
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
