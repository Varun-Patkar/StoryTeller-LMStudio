import { LMStudioClient } from "@lmstudio/sdk";

// Normalise the base URL. LM Studio's SDK speaks WebSocket; its OpenAI-compatible REST API
// lives at http(s)://host:port/v1.
function normaliseHttp(baseUrl) {
	return (baseUrl || "http://localhost:1234")
		.replace(/\/+$/, "")
		.replace(/\/v1$/, "");
}
function toWs(baseUrl) {
	const http = normaliseHttp(baseUrl);
	return http.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function getClient(settings) {
	return new LMStudioClient({ baseUrl: toWs(settings.baseUrl) });
}

/**
 * List downloaded LLM models and which are currently loaded.
 * Best-effort across SDK versions; throws with a readable message on failure.
 */
export async function listModels(settings) {
	const client = getClient(settings);
	let downloaded = [];
	let loaded = [];
	try {
		downloaded = await client.system.listDownloadedModels("llm");
	} catch {
		try {
			downloaded = await client.system.listDownloadedModels();
		} catch (err) {
			throw new Error(
				`Could not reach LM Studio at ${settings.baseUrl}. Is the server running? (${err?.message || err})`,
			);
		}
	}
	try {
		loaded = await client.llm.listLoaded();
	} catch {
		loaded = [];
	}
	const loadedKeys = new Set(
		loaded.map((m) => m.identifier || m.modelKey || m.path),
	);
	return downloaded
		.map((m) => {
			const key = m.modelKey || m.path || m.identifier;
			return {
				key,
				displayName: m.displayName || key,
				loaded: loadedKeys.has(key),
			};
		})
		.filter((m) => m.key);
}

export async function loadModel(settings, modelKey, opts = {}) {
	const client = getClient(settings);
	const config = {};
	if (opts.contextLength) config.contextLength = Number(opts.contextLength);
	await client.llm.load(
		modelKey,
		Object.keys(config).length ? { config } : undefined,
	);
	return { ok: true };
}

export async function unloadModel(settings, modelKey) {
	const client = getClient(settings);
	await client.llm.unload(modelKey);
	return { ok: true };
}

/**
 * Generate text via LM Studio's OpenAI-compatible REST API.
 * mode "completions" sends the raw prompt (purest style mimicry, no chat template).
 * mode "chat" wraps it as a chat request with an optional system message.
 * Returns the full generated string (non-streaming).
 */
export async function generate(settings, { prompt, system = "" }) {
	const base = normaliseHttp(settings.baseUrl);
	const headers = { "Content-Type": "application/json" };
	if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

	const temperature = Number(settings.temperature ?? 0.9);
	const max_tokens = Number(settings.maxTokens ?? 4096);
	const model = settings.model || undefined;

	if ((settings.mode || "completions") === "chat") {
		const messages = [];
		if (system && system.trim())
			messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: prompt });
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages,
				temperature,
				max_tokens,
				stream: false,
			}),
		});
		if (!res.ok)
			throw new Error(
				`LM Studio chat error ${res.status}: ${await res.text()}`,
			);
		const data = await res.json();
		return data.choices?.[0]?.message?.content ?? "";
	}

	// completions: fold any system text in as a leading instruction block, then the prompt.
	const fullPrompt =
		system && system.trim() ? `${system.trim()}\n\n${prompt}` : prompt;
	const res = await fetch(`${base}/v1/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model,
			prompt: fullPrompt,
			temperature,
			max_tokens,
			stream: false,
		}),
	});
	if (!res.ok)
		throw new Error(
			`LM Studio completions error ${res.status}: ${await res.text()}`,
		);
	const data = await res.json();
	return data.choices?.[0]?.text ?? "";
}
