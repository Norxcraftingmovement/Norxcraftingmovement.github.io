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
- Panel radius 16px, controls 8px. Soft shadows belong to broad white surfaces; inputs retain visible borders. Operational text stays on light low-variation surfaces; Orders uses the bounded frosted treatment below and confirmation dialogs remain opaque.
- Dark primary buttons with white labels; secondary white buttons; destructive red. Minimum action height 44px; focus uses dark rust, dark rust on light Overview controls.
- Keep financial confirmations, QR explanation, errors, empty/loading/disabled states, native keyboard controls and print layout. Settings uses real anchor links to existing sections, without hiding any form.
- Warm background light and frosted surfaces are CSS-only and static, confined to Overview introduction/round context. Overview queues and Settings forms remain opaque white; Orders uses the later material refinement below. Backdrop blur is progressive enhancement: unsupported browsers get opaque warm panels; print removes blur. No 3D scene, background video, extra requests, tracking or runtime dependency.
- Raster preview provenance: screenshots of local synthetic app with test-only records; not production data and not generated product photography.

28 Nov owner clarification: prioritize the soft warm neutrals and frosted translucency in the reference. Keep charcoal navigation; use translucent white on Overview header/round context, while keeping money/order text on bounded light backgrounds. Bounded light CSS gradients keep text readable without photography or 3D. Background does not tile; body fills the viewport.

## Type and spacing refinement — 28 Nov
Keep Sarabun. Body 16px with 1.65 line height; section headings 20px; standard page heading 32px (mobile 30px). Operational metadata/badges/actions have 14px floor except navigation group/brand captions; queue supporting copy 15px/24px, task titles 18px desktop/17px mobile. Standard page headings use normal tracking; Overview title retains its display treatment. Spacing scale 8/12/16/20/24/32px: related controls closer, panels separated by 24px, queue rows 20px, forms labels 16px above/6px below. Order status badge separated from identifier, long names wrap, totals retain tabular numbers; action targets at least 44px.

## Orders composition and controls — 28 Nov
Owner identified remaining gaps in material, button weight and color area. Orders now uses a beige canvas with bounded soft CSS light behind frosted panels; opaque warm fallback without blur. This is an abstract material study, not product photography. Visible beige/translucent areas dominate; ink is concentrated in navigation/type and one primary pill action per order. Primary and secondary controls remain at least 44px high, with 14px labels and compact intrinsic widths. Cancellation/reversal stay visible in a separate text-action row, with existing confirmation. Pickup primary is always handover. No new menus or extra steps. Orange is ambient light, not a large button fill. Print removes material effects.

28 Nov correction: remove the outlined circular reflection from Orders background on all sizes. Owner found it distracting on mobile. Keep only soft beige/orange light and frosted panels; no visible rings.

## Production and Settings — 28 Nov
Extend accepted warm frosted material and compact pills to these two Orders-owned pages, without rings. Production puts stock-state counts and receipt actions before the detailed horizontally scrollable table; four counts stay mathematically unchanged (partial receipts included), 2×2 on mobile. Reversal is a low-weight text action, not the primary button. Details table is keyboard-focusable and names its scroll region. Settings retains all forms and approval boundaries, with subheadings for recipient, storefront, contact, notification and selling mode. Sender label preview remains opaque white. Print reveals only Production main content while excluding its controls and removing material effects.

## Shipping workspace — 28 Nov
Extend accepted beige/frosted material and compact pill controls to Shipping. Desktop pairs selectable order list with opaque white label preview; mobile stacks them. Separate print/address actions, native-disclosure downloads, and tracking/shipped-record actions. Paper controls and list labels have generous touch areas. Explain ineligible shipments and why single-order actions disable for multiple selection. Printing/export and tracking metadata retain their distinct status semantics. Changing selection/format immediately disables affected actions; versioned label loads cannot update the cache, layout or actions after a newer selection. Physical print dimensions and sender/recipient rendering stay unchanged.
