# Kheyflix UX bug report

Tested on 2026-08-23 against the local Vinext development build at `http://localhost:3000`, using the live AllDebrid/Prowlarr-backed catalog. Desktop and 375 × 812 mobile layouts were exercised. The report contains only issues reproduced in the running UI.

## Summary

| ID | Severity | Area | Bug |
| --- | --- | --- | --- |
| UX-01 | High | Catalog rendering | Duplicate title IDs produce React key collisions and stale/omitted cards |
| UX-02 | Medium | Catalog search | A Movies search silently carries into Series, and vice versa |
| UX-03 | Medium | Search | Whitespace-only searches create contradictory results |
| UX-04 | High | Player | Leaving while playback requests are in flight can reopen an older player |
| UX-05 | Medium | Discovery | The loading button loses its accessible name and offers no recovery while a request hangs |
| UX-06 | Medium | Profiles | Saving an empty profile silently does nothing |
| UX-07 | Low | Catalog cards | Singular episode counts are displayed as “1 episodes” |
| UX-08 | Medium | Header search | The collapsed search field remains exposed to assistive technology but cannot be operated |

## UX-01 — Duplicate title IDs corrupt catalog rendering

**Severity:** High

The live catalog contains two distinct `Friends` entries that both render with the React key `series-friends`. React logs repeated duplicate-key errors. After changing a global search from `shrek` to three spaces, an unrelated Friends card remains mounted even though the page simultaneously reports `0 titles` and `No matching titles`. Duplicate keys can also cause cards to be omitted or reuse another title's UI state.

### Reproduction

1. Open Home and wait for the catalog.
2. Open global search and enter `shrek`.
3. Replace the query with three spaces.
4. Observe `0 titles` and `No matching titles` while a Friends card is still displayed.
5. Open the browser console and observe repeated `Encountered two children with the same key ... series-friends` errors.

### Expected

Every rendered catalog item has a stable, unique identity. An empty result set displays no title cards and produces no React key errors.

## UX-02 — Section search leaks across Movies and Series

**Severity:** Medium

Movies and Series share the same local query state. A user who searches one section and changes section sees the other section unexpectedly filtered by the previous query.

### Reproduction

1. Open Movies.
2. Enter `Shrek` in **Search movies**.
3. Click **Series**.
4. Observe **Search series** already contains `Shrek` and Series shows no matches.

### Expected

Movies and Series maintain independent search values, or navigation intentionally clears the section filter.

## UX-03 — Whitespace-only searches are treated as real queries

**Severity:** Medium

Both section and global catalog searches use the raw query rather than a normalized query. Spaces therefore produce a no-results page, a URL such as `/search?q=%20%20%20`, and a heading that visually contains a blank quoted term. Combined with UX-01, a stale card may remain alongside the empty state.

### Reproduction

1. Open Series.
2. Enter three spaces in **Search series**.
3. Observe `0 titles` and `No matching titles` instead of the full Series catalog.
4. Open global search and enter three spaces.
5. Observe the URL `/search?q=%20%20%20` and the heading `Results for “ ”`.

### Expected

Queries are trimmed and internal whitespace is normalized before filtering or updating the URL. A whitespace-only query behaves like an empty search.

## UX-04 — In-flight playback can reopen an older player after exit

**Severity:** High

Playback preparation from an earlier episode can win a race after the user has moved to another episode and clicked **Back to browsing**. The app briefly exits, then returns to the older episode's player, preventing the intended navigation.

### Reproduction

1. Open **The Mentalist** details.
2. Select Season 3 and open Episode 1 while it is still `Preparing compatible playback…`.
3. Click **Next episode**.
4. Immediately click **Back to browsing**.
5. Try to select **Discover**.
6. Observe that browsing controls disappear and the player reappears on Season 3 Episode 1.

### Expected

Leaving the player cancels or invalidates all pending playback work. An older request must never restore player state after navigation.

## UX-05 — Discovery loading state is unnamed and can trap the user

**Severity:** Medium

During a discovery search, the **Search** button becomes an icon-only disabled button with no accessible name. If the connected source stalls, the page remains in that state without a timeout, error, retry, or cancel action.

### Reproduction

1. Open Discover.
2. Search for `zzzzzzzzzzzzzzzzzz`.
3. Inspect the loading control with a screen reader or accessibility tree: it is announced only as an unnamed disabled button.
4. When the source does not respond, observe that the spinner remains and there is no cancel/retry path.

### Expected

The control retains an accessible name such as `Searching…`. Network work has a bounded timeout and resolves to a clear error with retry/cancel options.

## UX-06 — Empty profile save fails silently

**Severity:** Medium

The Add Profile editor permits clicking **Save** with an empty name. Nothing happens and no inline validation, announcement, or disabled state explains why.

### Reproduction

1. Open the profile menu.
2. Select **Manage Profiles**.
3. Select **Add Profile**.
4. Leave **Profile name** empty and click **Save**.
5. Observe that the dialog remains unchanged and no validation message appears.

### Expected

Save is disabled until a trimmed name is valid, or the form displays and announces an inline validation error while retaining focus appropriately.

## UX-07 — Singular episode grammar is incorrect

**Severity:** Low

Series with one episode show `1 episodes · Ready to stream`.

### Reproduction

1. Open Series.
2. Find **Undercover Billionaire** or **Le meilleur patissier - 2021**.
3. Observe `1 episodes · Ready to stream`.

### Expected

The card displays `1 episode · Ready to stream`.

## UX-08 — Collapsed header search is exposed but not operable

**Severity:** Medium

When global search is closed, its textbox remains in the accessibility tree as **Search titles**, although the visible UI only provides the **Open search** icon. Automation and keyboard-style interaction can resolve the textbox but cannot click or type into it because the collapsed control is not actually operable. This creates a misleading focus/announcement target for assistive-technology users.

### Reproduction

1. Open Home, Movies, or Series with global search closed.
2. Inspect the accessibility tree or navigate header controls with assistive technology.
3. Observe a **Search titles** textbox is exposed alongside **Open search**.
4. Attempt to activate/type in the textbox; it cannot be operated until **Open search** is activated.

### Expected

The collapsed textbox is removed from the accessibility tree and tab order (`hidden`, conditional rendering, or equivalent), leaving only the operable **Open search** button.

## Final one-by-one verification checklist

Run these after fixes on a clean reload:

- [ ] UX-01: Repeat the `shrek` → spaces global-search sequence; verify no stale card and no duplicate-key console error.
- [ ] UX-02: Search Movies for `Shrek`, switch to Series; verify Series has a cleared or independent query.
- [ ] UX-03: Enter only spaces in both search surfaces; verify each behaves as an empty search and the URL contains no whitespace query.
- [ ] UX-04: Start Episode 1, advance, then exit during preparation; verify the player never reopens.
- [ ] UX-05: Start discovery search; verify the loading button is named and a stalled request reaches a recoverable error.
- [ ] UX-06: Save an empty profile; verify clear, announced validation or a disabled Save button.
- [ ] UX-07: Inspect a one-episode series card; verify the singular noun.
- [ ] UX-08: Inspect the closed header; verify the hidden textbox is absent from accessibility navigation.

