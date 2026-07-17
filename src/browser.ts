import { chromium, type Browser, type BrowserContext } from "playwright";
import type { BrowserConfig } from "./types.js";

export async function launchBrowser(config: BrowserConfig): Promise<Browser> {
  const primary = {
    headless: config.headless,
    ...(config.channel ? { channel: config.channel } : {}),
  };

  try {
    return await chromium.launch(primary);
  } catch (error) {
    if (!config.channel) throw error;
    return chromium.launch({ headless: config.headless });
  }
}

export async function enforceReadOnlyNetwork(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const method = route.request().method().toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}
