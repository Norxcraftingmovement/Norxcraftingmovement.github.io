import { $, api, notice, errText } from "./common.mjs";
import { loadAssets, buildLabel, renderA6 } from "./label-canvas.mjs";
const f = ["brandName", "senderName", "address", "phone"];
const sample = { orderNo: "SAMPLE-0001", recipient: "ทดสอบ นามสมมติ", phone: "0800000000", address: "99/9 หมู่ 9 ถนนทดสอบ ตำบลทดสอบ อำเภอเมืองสมมติ จังหวัดสมมติ 10000", itemCount: 2 };
const read = () => Object.fromEntries(f.map((k) => [k, $(k).value]));
async function preview() {
  const s = read(), c = $("preview"), r = renderA6(buildLabel(sample, f.every((k) => s[k].trim()) ? s : null), 100);
  c.width = r.width; c.height = r.height; c.getContext("2d").drawImage(r, 0, 0);
}
(async () => {
  await loadAssets();
  try { const { sender } = await api("/api/admin/settings/sender"); if (sender) for (const k of f) $(k).value = sender[k] ?? ""; else notice($("notice"), "ยังไม่ได้ตั้งค่าผู้ส่ง — กรอกข้อมูลแล้วกดบันทึกก่อนพิมพ์ใบจ่าหน้า"); } catch (e) { notice($("notice"), errText(e), true); }
  for (const k of f) $(k).addEventListener("input", preview);
  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault(); $("save").disabled = true;
    try { await api("/api/admin/settings/sender", { method: "PUT", body: read() }); notice($("notice"), "บันทึกข้อมูลผู้ส่งแล้ว"); } catch (e) { notice($("notice"), errText(e), true); }
    $("save").disabled = false;
  });
  preview();
})();
