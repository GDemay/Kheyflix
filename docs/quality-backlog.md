# Kheyflix quality backlog

This living backlog is evidence-driven. Items move only after a reproduced defect, a focused regression, and production-safe verification.

## P0 — release blockers

1. **Exact-release access boundary:** The controlled, server-side access gate is implemented and covered locally, but the exact merged production revision must have its required server-side configuration, deny anonymous provider work, and preserve the normal authenticated catalog and playback journey. No configuration value is recorded in this repository or backlog.
2. **Exact-release Safari playback:** A real live-catalog title now decodes and advances continuously in local macOS Safari and the iPhone simulator. The same first-frame and continuous-playback proof is still required on the exact deployed merge commit. Chromium device emulation is not substitute evidence.

## P1 — reliability and performance

1. **Exact-release capacity and recovery proof:** Bootstrap quality is now preserved end-to-end; bounded native-HLS recovery, session handoff, prewarming, cancellation, and capacity release are covered locally. Confirm no unexpected capacity failure or stuck recovery on the deployed revision.
2. **Cross-instance access throttling:** The local rate limiter deliberately ignores spoofable forwarding headers and only provides per-instance abuse friction. If this controlled service expands, move brute-force controls to a trusted, durable edge/identity service.
3. **Native Apple adaptive quality:** Auto deliberately preserves the proven 480p native-HLS session because replacing a live single-variant playlist interrupts Safari. Build a true multi-variant HLS manifest before re-enabling seamless automatic Apple quality upgrades.
4. **Provider resilience under real outage:** Retry classification, `Retry-After`, cancellation propagation, resolver deadlines, link refresh, preparation durability, and operation timing have focused regression coverage. Continue validating error copy and recovery behavior against non-destructive real-provider failures after release.
5. **Production observability retention:** The release adds safe operation timing and playback diagnostics. Establish retention, alert thresholds, and a privacy-reviewed aggregation path before treating the data as an operational SLO.

## Resolved / verified policy work

- **Railway MCP-only delivery policy (2026-08-29):** PR [#64](https://github.com/GDemay/Kheyflix/pull/64), merged as `1a0ae288b819cd6d05502ab2234bc14dace8daf8`, removed the direct Railway CLI/token path, added a policy regression test, and passed exact-head CI/CD plus independent production health and catalog verification. The deployment workflow now fails closed outside the approved Railway MCP process.
- **Provider access and direct-egress hardening (local, 2026-08-30):** Provider-backed API routes now require an opaque, signed HttpOnly `Secure; SameSite=Strict` browser session. Access-code comparison is constant-time, server-side only, and request bodies are bounded. The stream relay is the default, has a bounded first-byte deadline, refreshes one stale provider link before forwarding bytes, cancels abandoned work, and pins each outbound HTTPS connection to the public DNS answers it validated while preserving the provider hostname for TLS.
- **SSRF and verification-boundary review (local, 2026-08-30):** Independent review found that hexadecimal IPv4-mapped IPv6 literals could bypass the first DNS-pinning implementation. The relay now parses IPv6 address bits and rejects private IPv4-compatible, mapped, translated, NAT64, 6to4, and Teredo endpoints; regression cases include both dotted and canonical hexadecimal mapped loopback/private forms. The review also found that a staging verifier would request a production-audience OIDC token. That unsupported alias was removed and now fails closed until staging receives its own reviewed identity contract.
- **Provider and playback resilience (local, 2026-08-30):** AllDebrid/Prowlarr work has bounded retry and deadline behavior, coalesced/cache-aware resolution, operation timing, safe health reporting, and preparation polling that does not duplicate known magnets. Native HLS uses finite 15-second VOD windows with one bounded warm successor; the player distinguishes intentional handoff from rebuffering and permits one position-preserving recovery session before surfacing a terminal, actionable failure.
- **Native Apple HLS continuity (local, 2026-08-30):** Reproduced the Safari interruption caused by Auto 480p-to-original source replacement. Native Auto now holds the continuous 480p HLS path; pause/resume releases the old rolling playlist before starting a fresh one at the exact saved position. With the live-catalog title *Friends S01E01*, macOS Safari showed a decoded frame by 12.507 seconds and advanced from 3:15 to 4:32 over 80.451 seconds; the iPhone simulator showed a decoded frame by 7.552 seconds and remained visibly decoded after 70.264 seconds. Both runs crossed multiple 15-second VOD windows. After client cleanup, transcoder capacity returned to two available slots with zero startup timeouts, encoder exits, or capacity rejections. Exact-release production verification remains required.
- **Exact release verification (local, 2026-08-30):** The deployment verifier now fails closed when `EXPECTED_COMMIT` does not match public health, and the production workflow passes `${{ github.sha }}` into that assertion after its deployment wait.

## P2 — product polish

1. Durable identity, entitlement, invite distribution, and any individual provider-account model (a material product/legal decision before broad public availability).
2. True multi-variant Apple HLS with seamless quality adaptation.
3. Player shortcut scope and hidden-control keyboard focusability.
4. iOS subtitle delivery/capability signaling.
5. Search focus restoration, dialog semantics, and select focus visibility.
6. Intent-based trailer loading and metadata request budget.
7. Content ranking/genre rails, personalization, and richer empty states.
8. Security headers, language metadata, and route-handler readability.
