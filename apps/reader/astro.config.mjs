// @ts-check
import { defineConfig } from "astro/config";

// Static reader deployed to GitHub Pages. Update `site` if your username/repo differ.
// `base` must match the repository name for project Pages.
const REPO = "StoryTeller-LMStudio";
export default defineConfig({
	site: `https://varun-patkar.github.io`,
	base: process.env.PAGES_BASE ?? `/${REPO}`,
	output: "static",
	trailingSlash: "ignore",
});
