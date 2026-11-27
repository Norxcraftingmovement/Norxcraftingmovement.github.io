# NORX Admin visual direction

Mode: Operate. Owner runs the shop from a phone or computer under ordinary indoor light. Readable order details, money and clear next actions take priority.

Owner references (27 Nov 2026): monochrome fashion composition; product UI style guide; soft sculptural panels; orange light on dark; monochrome textile motion. Black/white is NORX's original identity. Orange is an experiment, not a permanent brand decision.

## Direction contract
THESIS: monochrome workbench with a warm frosted introduction. Keep familiar navigation and daily queues; avoid immersive backgrounds behind operational data.
OWN-WORLD: charcoal #20211f, warm off-white #f3f0ea, white paper, neutral lines; orange #ed713b only as a small selection indicator and overview light. Semantic green/red/amber retain their meaning. Sarabun self-hosted for Thai and Latin; no new fonts or libraries.
STORY: identify current section, see today's work, enter the relevant queue, complete the existing protected action.
FIRST VIEWPORT: desktop dark sidebar; Overview light frosted introduction above an opaque white task list with right-aligned counts and a separate round panel. Mobile native menu, one column; the work list precedes round details.
FORM: refinement of the existing shell and task layout, pinned by owner references; seed: none (unavailable).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Built component rules
- theme.css follows style.css on all six Orders-owned Admin pages. Existing Events/Media links remain; those separate consoles are outside this visual update.
- Panel radius 16px, controls 8px. Soft shadows belong to broad white surfaces; inputs retain visible borders. Data surfaces are opaque.
- Dark primary buttons with white labels; secondary white buttons; destructive red. Minimum action height 44px; focus uses dark rust, dark rust on light Overview controls.
- Keep financial confirmations, QR explanation, errors, empty/loading/disabled states, native keyboard controls and print layout. Settings uses real anchor links to existing sections, without hiding any form.
- Warm background light and frosted surfaces are CSS-only and static, confined to Overview introduction/round context. Operational queues/forms remain opaque white. Backdrop blur is progressive enhancement: unsupported browsers get opaque warm panels; print removes blur. No 3D scene, background video, extra requests, tracking or runtime dependency.
- Raster preview provenance: screenshots of local synthetic app with test-only records; not production data and not generated product photography.

28 Nov owner clarification: prioritize the soft warm neutrals and frosted translucency in the reference. Keep charcoal navigation; use translucent white on Overview header/round context, not behind money or order details. Bounded light CSS gradients keep text readable without photography or 3D. Background does not tile; body fills the viewport.
