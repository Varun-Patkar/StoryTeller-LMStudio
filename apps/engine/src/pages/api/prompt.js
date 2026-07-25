import {
	readGlobalPrompt,
	writeGlobalPrompt,
	deleteGlobalPrompt,
	listGlobalSamples,
} from "../../lib/books.js";

export const prerender = false;

// GET ?rel=system.md        → { content }
// GET  (no rel)             → { samples: [...] }
export async function GET({ url }) {
	try {
		const rel = url.searchParams.get("rel");
		if (rel) return json({ content: await readGlobalPrompt(rel) });
		return json({ samples: await listGlobalSamples() });
	} catch (err) {
		return json({ error: err.message }, 400);
	}
}

export async function PUT({ request }) {
	try {
		const { rel, content } = await request.json();
		if (!rel) return json({ error: "rel is required" }, 400);
		await writeGlobalPrompt(rel, content ?? "");
		return json({ ok: true });
	} catch (err) {
		return json({ error: err.message }, 400);
	}
}

export async function DELETE({ request }) {
	try {
		const { rel } = await request.json();
		if (!rel) return json({ error: "rel is required" }, 400);
		await deleteGlobalPrompt(rel);
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
