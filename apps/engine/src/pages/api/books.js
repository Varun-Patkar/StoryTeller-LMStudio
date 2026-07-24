import { listBooks, createBook } from "../../lib/books.js";

export const prerender = false;

export async function GET() {
	return json(await listBooks());
}

export async function POST({ request }) {
	try {
		const { name, title } = await request.json();
		const slug = await createBook(name || title, title || name);
		return json({ slug });
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
