# MOVE KIDS — registration source and implementation mapping
Reviewed: 2026-11-26 (Asia/Bangkok), from owner's published Google Form editor; response count was 0 at review.
Status: source mapping, not approval to publish or open registration. This document supersedes any earlier Google Form fallback suggestion: the owner requires native registration on the NORX website.

## User journey
QR / direct link -> `/events/move-kids-2026/` -> read event information -> native registration form -> server-confirmed success + registration reference. No redirect to, embedding of, or submission through Google Forms. Database: separate Events D1 (not apparel Sheets).
Keep the registration endpoint disabled in production until final approval and tests. Before launch recheck legacy form count and reconcile if any submissions exist; do not run two independent public intake systems. Closing the legacy form requires owner approval at cutover.

## Source event facts
- Public source title: NORX × SUPERSPORTS | MOVE KIDS — 14K | 13 ธันวาคม 2569; tagline Every Kid Deserves to Play.
- Community Trail, not a race / no timing, Sunday 13 Dec 2026; meet 06:00 for check-in/briefing, start 06:30; expected school arrival by 10:00 and finish around 14:00 (subject to conditions).
- Loop from parking near Karen Ruammit elephant camp, Chiang Rai; school visit at Ban Ruammit School, Ban Ja To Beo classroom branch (use exact Thai name: โรงเรียนบ้านรวมมิตร สาขาห้องเรียนบ้านจะต๋อเบอ); return to the start.
- Elevation gain approx +450 m; uphill; self-supported, one support vehicle stationed at a point, no transport service; participants must check back in at finish.
- Free, no fixed participant limit, no stated minimum age, novice participants welcome if prepared for uphill terrain. No invented slots or countdown. Config must support finite capacity for future events, but this event is unlimited per current source.
- School sports equipment handover and relay with children; Supersports discount coupon. Use approved organizer/partner copy and logos only.
- Mandatory equipment: drinking water, food, reserve energy, personal medication if any. Respect school, community and environment; no littering.
- Source conflict: header/title and route description say 14 km, conditions say 13.2 km. Do not publish inconsistent numbers or silently resolve; owner must select exact source-of-truth distance.
- Keep original published map pin and organizer contact, verify them before publishing; do not expose private editor links or participant info in the public repo.

## Field mapping (exact source structure)
| Input | Required in source | Implementation |
|---|---|---|
| ชื่อ–นามสกุล | Yes | Text, trim + length validation |
| ชื่อเล่น | Yes | Text |
| อายุ | Yes | Numeric whole age; no guardian fields or guardian flow in the online registration form (owner decision 2026-11-27). |
| เบอร์โทรศัพท์ที่ติดต่อได้ | Yes | Phone, normalization and validation; allow relevant phone formats |
| ผู้ติดต่อฉุกเฉิน | Yes | Source combined name/phone/relationship; proposed individual fields for safety and usability |
| ประสบการณ์เดิน–วิ่ง / เทรล | Yes | Regular trail / some experience / new to trail (preserve Thai option labels) |
| ข้อมูลสุขภาพที่ทีมงานควรทราบ | No | Optional sensitive data; only enable with separately approved lawful basis, explicit consent where applicable, restricted access/retention; no health data in general export |
| เงื่อนไขการเข้าร่วม | Yes | Required standalone acknowledgement; use confirmed distance |
| การเตรียมตัวและความปลอดภัย | Yes | Required standalone acknowledgement |
| อุปกรณ์บังคับ | Yes | Required acknowledgement of the four equipment categories |
| การถ่ายภาพและวิดีโอ | Yes in source | Source makes promotional media consent a participation condition. FLAG — do not silently port it; propose truly optional separate consent or obtain legal review on necessity and alternative participation. Needs owner approval. |

## Required privacy/safety decisions before open
- Owner decision (2026-11-27): do not add guardian fields or a guardian-specific flow to the online form. This does not establish that parental consent or accompaniment can be waived where applicable; confirm minor eligibility, event-day safety and applicable consent arrangements separately before opening registration. Do not add sensitive guardian data to the form.
- Publish a specific privacy notice (purpose, access, retention, contact, rights; emergency contact handling), clear optional/required distinctions. Store consent version and timestamps as applicable.
- Health data is sensitive. Minimize collection, use role-limited access for safety personnel, never send to analytics or expose in public endpoints, logs, generic exports, or GitHub. Consider not collecting health online unless approved and necessary.
- Media permission is separate from safety acknowledgements; consent design needs owner/legal review, not an automatic condition on the signup. See Thai PDPA sections 19,20,23,26, official ministry hosted translation: https://www.mdes.go.th/law/detail/3577-Personal-Data-Protection-Act-B-E--2562--2019
- Do not add a required account/email/cache of personal data or real participant test records without clear need/approval.

## Native form UI and release QA
- Single event landing page with an obvious CTA and stable QR destination, mobile first. Event facts and schedule first; form divided into participant / emergency + experience / safety & privacy. Clear error messages near fields and persistent input through recoverable submission failure.
- QR should link directly to the final HTTPS event URL, not the Google Form; avoid generating/promoting QR until route verified and signup is ready.
- On confirmation show only registration reference/status + date, meeting point/brief, preparation; no personal/health details in URL. Prevent double-submit and issue one record per successful idempotent request. Never show success before D1 commit.
- Staff dashboard protected; check-in and finish accountability; owner-only export of minimal necessary data. No public roster or names.
- Verify synthetic open/closed submissions, invalid fields, age validation and approved minor eligibility arrangements, optional consent, retry, API failure, rate limit, restricted data access, stable QR URL, mobile 360/390 and shop regression.
- Release only after distance and consent/safety rules are signed off and owner approves publication/opening.
