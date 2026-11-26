# MOVE KIDS registration and sharing controls
- Owner-only dashboard: /admin/events/ (existing Cloudflare Access and JWT checks).
- Database switch starts CLOSED. Apply migration 0004 before deploying admin mode. Worker flag "0" is an emergency hard close; "admin" reads D1. New registration writes are guarded atomically by the current control row. No production signup fixtures.
- Confirm before toggling. Public signup URL stays stable when closed. Copy, native share (clipboard fallback), and owner-only PNG download point to https://norxcraftingmovement.com/events/move-kids-2026/.
- QR: locally encoded with ReportLab, error correction M, 4-module quiet zone, 984px square, no third-party request.
- Preview uses synthetic demo data and cannot write real registrations or switch state.
- QA: 26 local tests passed, including authorization, cross-origin requests, closed default, simulated open/close, concurrent close, QR PNG and preview isolation. Physical QR scan not tested.
