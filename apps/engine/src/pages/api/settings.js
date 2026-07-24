import { loadSettings, saveSettings } from "../../lib/settings.js";

export const prerender = false;

export async function GET() {
	const s = await loadSettings();
	return json(s);
}

export async function POST({ request }) {
	try {
		const patch = await request.json();
		const next = await saveSettings(patch);
		return json(next);
	} catch (err) {
		return json({ error: err.message }, 400);
	}
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
