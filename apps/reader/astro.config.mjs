// @ts-check
import { defineConfig } from "astro/config";

// Static reader deployed to GitHub Pages. Update `site` if your username/repo differ.
// `base` must match the repository name for project Pages. The trailing slash matters:
// pages build links as `${BASE_URL}<path>`, so BASE_URL must end in "/".
const REPO = "StoryTeller-LMStudio";
export default defineConfig({
	site: `https://varun-patkar.github.io`,
	base: process.env.PAGES_BASE ?? `/${REPO}/`,
	output: "static",
	trailingSlash: "ignore",
});
