import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_argus",
  dirs: ["./trigger"],
  runtime: "node-22",
  logLevel: "info",
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 30000, factor: 2 },
  },
});
