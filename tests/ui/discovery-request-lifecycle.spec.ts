import { expect, test } from "@playwright/test";

test("leaving discovery cancels a pending search without a client error", async ({ page }) => {
  let releaseSearch: () => void;
  const searchStarted = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  let started = false;
  const clientErrors: string[] = [];

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
      if (url.pathname === "/api/discovery/search")
        signal?.addEventListener("abort", () => {
          (window as Window & { __kheyflixDiscoverySearchAborted?: boolean })
            .__kheyflixDiscoverySearchAborted = true;
        }, { once: true });
      return originalFetch(input, init);
    };
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("api.request.failed"))
      clientErrors.push(message.text());
  });
  await page.route("**/api/discovery/search?*", async (route) => {
    started = true;
    await searchStarted;
    try {
      await route.fulfill({ json: { results: [] } });
    } catch {
      // The browser intentionally aborts this route when Discovery unmounts.
    }
  });

  try {
    await page.goto("/discover");
    await page.getByLabel("Search connected sources").fill("Pending Movie");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(() => started).toBe(true);

    await page.getByRole("button", { name: "Kheyflix home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() =>
      Boolean((window as Window & { __kheyflixDiscoverySearchAborted?: boolean })
        .__kheyflixDiscoverySearchAborted),
    )).toBe(true);
    expect(clientErrors).toEqual([]);
  } finally {
    releaseSearch!();
  }
});
