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
 * Ensure a model is loaded before generation (just-in-time loading).
 * If the model is already loaded, this is a no-op. Otherwise it is loaded with
 * the given context length (if provided). No-op when modelKey is falsy.
 */
export async function ensureLoaded(settings, modelKey, contextLength) {
	if (!modelKey) return { ok: true, skipped: true };
	const client = getClient(settings);
	let loaded = [];
	try {
		loaded = await client.llm.listLoaded();
	} catch {
		loaded = [];
	}
	const loadedKeys = new Set(
		loaded.map((m) => m.identifier || m.modelKey || m.path),
	);
	if (loadedKeys.has(modelKey)) return { ok: true, alreadyLoaded: true };
	const config = {};
	if (contextLength) config.contextLength = Number(contextLength);
	await client.llm.load(
		modelKey,
		Object.keys(config).length ? { config } : undefined,
	);
	return { ok: true, loaded: true };
}

/**
 * Generate text via LM Studio's OpenAI-compatible REST API.
 * mode "completions" sends the raw prompt (purest style mimicry, no chat template).
 * mode "chat" wraps it as a chat request with an optional system message.
 * Returns the full generated string (non-streaming).
 * `model` overrides settings.model for this single request (chosen per generation).
 */
export async function generate(settings, { prompt, system = "", model }) {
	const base = normaliseHttp(settings.baseUrl);
	const headers = { "Content-Type": "application/json" };
	if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

	const temperature = Number(settings.temperature ?? 0.9);
	const max_tokens = Number(settings.maxTokens ?? 4096);
	const modelName = model || settings.model || undefined;

	if ((settings.mode || "completions") === "chat") {
		const messages = [];
		if (system && system.trim())
			messages.push({ role: "system", content: system });
		messages.push({ role: "user", content: prompt });
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: modelName,
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
			model: modelName,
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

/**
 * Agentic generation via LM Studio's OpenAI-compatible chat API with tool calling.
 *
 * The model is handed a lean prompt plus read-only tools and drives its own context
 * gathering: it may call tools (which we execute against the human-authored book files),
 * read the results, and loop until it returns final prose. This uses far fewer tokens
 * than dumping every memory file up front.
 *
 * @param settings   engine settings (baseUrl, apiKey, model, temperature, maxTokens…)
 * @param opts.messages    initial chat messages ([system?, user]).
 * @param opts.tools       tool schema array (OpenAI function-calling format).
 * @param opts.runTool     async (name, args) => string; executes one tool call.
 * @param opts.model       model override for this request.
 * @param opts.maxSteps    max tool-calling rounds before forcing a final answer.
 * @returns { text, steps } — final prose and how many tool rounds ran.
 */
export async function generateAgentic(
	settings,
	{ messages, tools, runTool, model, maxSteps = 8 },
) {
	const base = normaliseHttp(settings.baseUrl);
	const headers = { "Content-Type": "application/json" };
	if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

	const temperature = Number(settings.temperature ?? 0.9);
	const max_tokens = Number(settings.maxTokens ?? 4096);
	const modelName = model || settings.model || undefined;
	const convo = [...messages];

	for (let step = 0; step <= maxSteps; step++) {
		// On the final allowed step, stop offering tools so the model must answer.
		const offerTools = step < maxSteps;
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: modelName,
				messages: convo,
				temperature,
				max_tokens,
				stream: false,
				...(offerTools && tools?.length
					? { tools, tool_choice: "auto" }
					: {}),
			}),
		});
		if (!res.ok)
			throw new Error(
				`LM Studio chat error ${res.status}: ${await res.text()}`,
			);
		const data = await res.json();
		const msg = data.choices?.[0]?.message;
		if (!msg) throw new Error("LM Studio returned no message.");
		convo.push(msg);

		const calls = msg.tool_calls || [];
		if (!calls.length) {
			return { text: msg.content ?? "", steps: step };
		}

		// Execute every requested tool and feed the results back in.
		for (const call of calls) {
			let args = {};
			try {
				args = call.function?.arguments
					? JSON.parse(call.function.arguments)
					: {};
			} catch {
				args = {};
			}
			const result = await runTool(call.function?.name, args);
			convo.push({
				role: "tool",
				tool_call_id: call.id,
				content: String(result ?? ""),
			});
		}
	}
	// Ran out of steps without a plain answer; return the last content if any.
	const last = [...convo].reverse().find((m) => m.role === "assistant");
	return { text: last?.content ?? "", steps: maxSteps };
}

