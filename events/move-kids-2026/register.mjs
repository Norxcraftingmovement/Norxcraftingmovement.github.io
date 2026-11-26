const route = "/api/events/move-kids-2026/registration";
const form = document.querySelector(".registration-form");
const status = document.querySelector(".registration-status");
const submit = form.querySelector("button");
const testSections = Array.from(form.querySelectorAll("fieldset")).slice(0, 3);
const mediaConsent = form.elements.namedItem("mediaConsent");
const fields = ["fullName", "nickname", "age", "phone", "emergencyName", "emergencyPhone",
  "emergencyRelationship", "experience", "termsAccepted", "safetyAccepted", "equipmentAccepted",
  "mediaConsent"];
let registrationOpen = false;
let identity;

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!registrationOpen || submit.disabled) return;
  const values = {};
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    values[field] = control.type === "checkbox" ? control.checked :
      control.type === "number" ? control.valueAsNumber : control.value.trim();
  }
  const payload = JSON.stringify(values);
  if (identity?.payload !== payload) identity = { key: crypto.randomUUID(), payload };
  submit.disabled = true;
  status.textContent = "กำลังส่งใบสมัคร…";
  try {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, key: identity.key }),
    });
    const result = await response.json();
    if (response.ok && typeof result.reference === "string") {
      status.textContent = (result.test ? "ทดสอบบันทึกสำเร็จ" : "สมัครสำเร็จ") + " · เลขอ้างอิง " + result.reference;
      form.reset();
      identity = undefined;
      return;
    }
    status.textContent = result.error === "INVALID"
      ? "กรุณาตรวจช่องที่กรอก โดยเฉพาะเบอร์โทรและการรับทราบเงื่อนไข"
      : "บันทึกไม่สำเร็จ ลองกดส่งอีกครั้งได้";
  } catch {
    status.textContent = "ติดต่อระบบไม่ได้ ข้อมูลที่กรอกยังอยู่ ลองส่งอีกครั้งได้";
  } finally {
    submit.disabled = false;
  }
});

{
  try {
    const response = await fetch(route);
    const settings = await response.json();
    if (response.ok && settings.open === true) {
      registrationOpen = true;
      for (const section of testSections) section.disabled = false;
      mediaConsent.closest("fieldset").disabled = false;
      submit.type = "submit";
      submit.disabled = false;
      submit.textContent = settings.test ? "ส่งข้อมูลตัวอย่าง" : "ยืนยันการสมัคร";
      status.textContent = settings.test ? "ทดสอบในเครื่องเท่านั้น · ใช้ข้อมูลสมมติ" : "เปิดรับสมัคร";
    }
  } catch {
    // Keep the preview closed when the Worker is unavailable.
  }
}
