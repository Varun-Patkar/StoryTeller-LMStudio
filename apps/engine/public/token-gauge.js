/**
 * token-gauge.js — a small circular gauge that fills as tokens are used, showing a single
 * generation's session usage against the model's context window.
 *
 * renderTokenGauge(el, used, max)
 *   el   — container element (given class "token-gauge").
 *   used — peak tokens used this run.
 *   max  — the model's context window (0/undefined → show raw count, full ring).
 */
window.renderTokenGauge = function (el, used, max) {
	if (!el) return;
	used = Number(used) || 0;
	max = Number(max) || 0;
	const r = 26;
	const c = 2 * Math.PI * r;
	const frac = max > 0 ? Math.min(1, used / max) : used > 0 ? 1 : 0;
	const pct = max > 0 ? Math.round(frac * 100) : null;
	const center = max > 0 ? pct + "%" : String(used);
	el.innerHTML =
		'<svg class="tg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">' +
		'<g transform="rotate(-90 32 32)">' +
		'<circle class="tg-track" cx="32" cy="32" r="' + r + '"></circle>' +
		'<circle class="tg-fill" cx="32" cy="32" r="' + r + '" style="stroke-dasharray:' +
		c.toFixed(1) + ";stroke-dashoffset:" + (c * (1 - frac)).toFixed(1) + '"></circle>' +
		"</g>" +
		'<text class="tg-num" x="32" y="33">' + center + "</text>" +
		"</svg>";
	el.title =
		max > 0
			? used + " / " + max + " tokens (" + pct + "%) this run"
			: used + " tokens this run";
	el.style.display = "inline-flex";
};
