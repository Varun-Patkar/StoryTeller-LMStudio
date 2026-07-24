import {
	readBookFile,
	writeBookFile,
	deleteBookFile,
} from "../../lib/books.js";

export const prerender = false;

export async function GET({ url }) {
	try {
		const slug = url.searchParams.get("slug");
		const rel = url.searchParams.get("rel");
		if (!slug || !rel) return json({ error: "slug and rel are required" }, 400);
		return json({ content: await readBookFile(slug, rel) });
	} catch (err) {
		return json({ error: err.message }, 400);
	}
}

export async function PUT({ request }) {
	try {
		const { slug, rel, content } = await request.json();
		if (!slug || !rel) return json({ error: "slug and rel are required" }, 400);
		await writeBookFile(slug, rel, content ?? "");
		return json({ ok: true });
	} catch (err) {
		return json({ error: err.message }, 400);
	}
}

export async function DELETE({ request }) {
	try {
		const { slug, rel } = await request.json();
		await deleteBookFile(slug, rel);
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
