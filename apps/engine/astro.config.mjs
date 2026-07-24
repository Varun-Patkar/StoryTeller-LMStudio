// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// The engine is a LOCAL-ONLY app. It runs as a Node server so it can talk to LM Studio
// and read/write the shared books/ folder. It is never built for or deployed to Pages.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: false },
});
