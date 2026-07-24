/**
 * model-picker.js — shared helper to populate a <select> with the models
 * currently available in LM Studio, used at each generation point.
 *
 * Loaded as a classic (non-module) inline script so it runs before the
 * page's module scripts and exposes `window.initModelPicker`.
 *
 * initModelPicker(selectEl, defaultModel)
 *   selectEl     — the <select> element to fill with <option>s.
 *   defaultModel — model key to pre-select (usually the saved default).
 * Returns a Promise that resolves once options are populated.
 */
window.initModelPicker = async function (selectEl, defaultModel) {
	if (!selectEl) return;
	selectEl.innerHTML = '<option value="">Loading models…</option>';
	try {
		const res = await fetch("/api/models");
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || "Failed to load models.");
		if (!data.models || !data.models.length) {
			selectEl.innerHTML = '<option value="">No models found</option>';
			return;
		}
		selectEl.innerHTML = "";
		for (const m of data.models) {
			const opt = document.createElement("option");
			opt.value = m.key;
			opt.textContent = m.displayName + (m.loaded ? " · loaded" : "");
			if (m.key === defaultModel) opt.selected = true;
			selectEl.appendChild(opt);
		}
	} catch (err) {
		selectEl.innerHTML =
			'<option value="">Error loading models — check Settings</option>';
	}
};
