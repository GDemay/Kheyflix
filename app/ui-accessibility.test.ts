import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./kheyflix-app";
import { isProfileNameValid } from "./profile-page";

describe("header search accessibility", () => {
  it("does not render the textbox when search is collapsed", () => {
    const markup = renderToStaticMarkup(createElement(Header, { route: { section: "home" }, navigate: vi.fn() }));
    expect(markup).toContain('aria-label="Open search"');
    expect(markup).not.toContain('aria-label="Search titles"');
    expect(markup).not.toContain('class="header-search');
  });

  it("renders the operable textbox and current query when open", () => {
    const markup = renderToStaticMarkup(createElement(Header, { route: { section: "search", query: "Arrival" }, navigate: vi.fn() }));
    expect(markup).toContain('class="header-search open"');
    expect(markup).toContain('aria-label="Search titles"');
    expect(markup).toContain('value="Arrival"');
    expect(markup).not.toContain('aria-label="Open search"');
  });
});

describe("profile name validation", () => {
  it.each(["", " ", "\t\n", "　"])("rejects an empty trimmed name", (name) => {
    expect(isProfileNameValid(name)).toBe(false);
  });

  it.each(["A", "  Cinema  ", "🎬"])("accepts a visible name", (name) => {
    expect(isProfileNameValid(name)).toBe(true);
  });
});
