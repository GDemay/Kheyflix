import { expect, test } from "@playwright/test";

const discoveryResult = (id: string, title: string, category: "movie" | "series" = "movie") => ({
  id,
  title: `${title}.2026.1080p.WEB-DL`,
  size: 2_000_000_000,
  seeders: 12,
  peers: 2,
  source: "Test source",
  category,
  magnet: `magnet:?xt=urn:btih:${id.toUpperCase()}`,
  metadata: {
    displayTitle: title,
    year: 2026,
    resolution: "1080p",
    seasonPack: false,
    audioLanguages: ["English"],
    subtitleLanguages: [],
  },
});

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

test("a new discovery search supersedes a pending request without stale results", async ({ page }) => {
  let releaseOldSearch!: () => void;
  const oldSearchReleased = new Promise<void>((resolve) => {
    releaseOldSearch = resolve;
  });
  let oldSearchStarted = false;
  let newSearchStarted = false;
  let oldSearchSettled!: () => void;
  const oldSearchFinished = new Promise<void>((resolve) => {
    oldSearchSettled = resolve;
  });
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
          const target = window as Window & {
            __kheyflixDiscoverySearchAborts?: string[];
          };
          target.__kheyflixDiscoverySearchAborts = [
            ...(target.__kheyflixDiscoverySearchAborts || []),
            url.searchParams.get("q") || "",
          ];
        }, { once: true });
      return originalFetch(input, init);
    };
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("api.request.failed"))
      clientErrors.push(message.text());
  });
  await page.route("**/api/discovery/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "Old title") {
      oldSearchStarted = true;
      await oldSearchReleased;
      try {
        await route.fulfill({ json: { results: [discoveryResult("old-title", "Old title")] } });
      } catch {
        // The intentionally superseded request no longer has a browser client.
      } finally {
        oldSearchSettled();
      }
      return;
    }
    if (query === "New title") {
      newSearchStarted = true;
      await route.fulfill({ json: { results: [discoveryResult("new-title", "New title")] } });
      return;
    }
    await route.fulfill({ json: { results: [] } });
  });

  try {
    await page.goto("/discover");
    const searchInput = page.getByLabel("Search connected sources");
    const submit = page.locator(".discovery-search button");
    await searchInput.fill("Old title");
    await submit.click();
    await expect.poll(() => oldSearchStarted).toBe(true);

    await searchInput.fill("New title");
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAccessibleName("Search again and replace the current search");
    await submit.click();

    await expect.poll(() => newSearchStarted).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __kheyflixDiscoverySearchAborts?: string[] })
        .__kheyflixDiscoverySearchAborts?.includes("Old title") || false,
    )).toBe(true);
    await expect(page.getByRole("heading", { name: "New title (2026)" })).toBeVisible();
    await expect(submit).toHaveAccessibleName("Search");
    await expect(submit).toBeEnabled();

    releaseOldSearch();
    await oldSearchFinished;
    await expect(page.getByRole("heading", { name: "Old title (2026)" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "New title (2026)" })).toBeVisible();
    expect(clientErrors).toEqual([]);
  } finally {
    releaseOldSearch();
  }
});

test("a replacement search clears prior releases before its response arrives", async ({ page }) => {
  let releaseReplacement!: () => void;
  const replacementReleased = new Promise<void>((resolve) => {
    releaseReplacement = resolve;
  });
  let replacementStarted = false;
  let replacementSettled!: () => void;
  const replacementFinished = new Promise<void>((resolve) => {
    replacementSettled = resolve;
  });

  await page.route("**/api/discovery/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "First title") {
      await route.fulfill({ json: { results: [discoveryResult("first-title", "First title")] } });
      return;
    }
    if (query === "Replacement title") {
      replacementStarted = true;
      await replacementReleased;
      try {
        await route.fulfill({ json: { results: [discoveryResult("replacement-title", "Replacement title")] } });
      } finally {
        replacementSettled();
      }
      return;
    }
    await route.fulfill({ json: { results: [] } });
  });

  try {
    await page.goto("/discover");
    const searchInput = page.getByLabel("Search connected sources");
    const submit = page.locator(".discovery-search button");
    await searchInput.fill("First title");
    await submit.click();
    await expect(page.getByRole("heading", { name: "First title (2026)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare", exact: true })).toBeVisible();

    await searchInput.fill("Replacement title");
    await submit.click();
    await expect.poll(() => replacementStarted).toBe(true);
    await expect(page.getByRole("heading", { name: "First title (2026)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Prepare", exact: true })).toHaveCount(0);

    releaseReplacement();
    await replacementFinished;
    await expect(page.getByRole("heading", { name: "Replacement title (2026)" })).toBeVisible();
  } finally {
    releaseReplacement();
  }
});

test("changing discovery type clears completed releases before a new search", async ({ page }) => {
  await page.route("**/api/discovery/search?*", async (route) => {
    await route.fulfill({ json: { results: [discoveryResult("completed-movie", "Completed movie")] } });
  });

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Completed movie");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Completed movie (2026)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare", exact: true })).toBeVisible();

  const contentType = page.getByRole("group", { name: "Content type" });
  await contentType.getByRole("button", { name: "Series", exact: true }).click();

  await expect(contentType.getByRole("button", { name: "Movies", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await expect(contentType.getByRole("button", { name: "Series", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Completed movie (2026)" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare", exact: true })).toHaveCount(0);
  await expect(page.getByText("Search to see available releases.")).toBeVisible();
  await expect(page.locator(".discovery-search button")).toHaveAccessibleName("Search");
  await expect(page.locator(".discovery-search button")).toBeEnabled();
});

test("changing discovery type cancels a pending search before stale results can render", async ({ page }) => {
  let releaseSearch!: () => void;
  const searchReleased = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  let searchStarted = false;
  let searchSettled!: () => void;
  const searchFinished = new Promise<void>((resolve) => {
    searchSettled = resolve;
  });
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
    searchStarted = true;
    await searchReleased;
    try {
      await route.fulfill({ json: { results: [discoveryResult("old-movie", "Old movie")] } });
    } catch {
      // The type switch intentionally makes this response stale.
    } finally {
      searchSettled();
    }
  });

  try {
    await page.goto("/discover");
    await page.getByLabel("Search connected sources").fill("Pending movie");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(() => searchStarted).toBe(true);

    const contentType = page.getByRole("group", { name: "Content type" });
    await contentType.getByRole("button", { name: "Series", exact: true }).click();
    await expect(contentType.getByRole("button", { name: "Movies", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
    await expect(contentType.getByRole("button", { name: "Series", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() =>
      Boolean((window as Window & { __kheyflixDiscoverySearchAborted?: boolean })
        .__kheyflixDiscoverySearchAborted),
    )).toBe(true);

    releaseSearch();
    await searchFinished;
    await expect(page.getByRole("heading", { name: "Old movie (2026)" })).toHaveCount(0);
    await expect(page.getByText("Search to see available releases.")).toBeVisible();
    await expect(page.locator(".discovery-search button")).toHaveAccessibleName("Search");
    await expect(page.locator(".discovery-search button")).toBeEnabled();
    expect(clientErrors).toEqual([]);
  } finally {
    releaseSearch();
  }
});
