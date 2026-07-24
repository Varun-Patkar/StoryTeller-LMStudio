import { appendSummary } from "../../lib/books.js";

export const prerender = false;

export async function POST({ request }) {
	try {
		const { slug, n, text } = await request.json();
		if (!slug || !n) return json({ error: "slug and n are required" }, 400);
		await appendSummary(slug, n, text || "");
		return json({ ok: true });
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
