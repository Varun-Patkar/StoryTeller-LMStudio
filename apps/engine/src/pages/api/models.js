import { loadSettings } from "../../lib/settings.js";
import { listModels, loadModel, unloadModel } from "../../lib/lmstudio.js";

export const prerender = false;

export async function GET() {
	try {
		const settings = await loadSettings();
		return json({ models: await listModels(settings) });
	} catch (err) {
		return json({ error: err.message }, 502);
	}
}

export async function POST({ request }) {
	try {
		const settings = await loadSettings();
		const { action, model, contextLength } = await request.json();
		if (action === "load") await loadModel(settings, model, { contextLength });
		else if (action === "unload") await unloadModel(settings, model);
		else return json({ error: "Unknown action" }, 400);
		return json({ ok: true, models: await listModels(settings) });
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
