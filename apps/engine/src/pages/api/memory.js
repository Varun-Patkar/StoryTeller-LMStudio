import { listMemory, memoryCategories } from "../../lib/books.js";

export const prerender = false;

export async function GET({ url }) {
	const slug = url.searchParams.get("slug");
	if (!slug) return json({ error: "slug is required" }, 400);
	return json({
		categories: memoryCategories(),
		memory: await listMemory(slug),
	});
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
