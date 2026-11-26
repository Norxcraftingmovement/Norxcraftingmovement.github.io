const route = "/api/events/move-kids-2026/registration";
const form = document.querySelector(".registration-form");
const status = document.querySelector(".registration-status");
const submit = form.querySelector("button");
const testSections = Array.from(form.querySelectorAll("fieldset")).slice(0, 3);
const mediaConsent = form.elements.namedItem("mediaConsent");
const fields = ["fullName", "nickname", "age", "phone", "emergencyName", "emergencyPhone",
  "emergencyRelationship", "experience", "termsAccepted", "safetyAccepted", "equipmentAccepted",
  "mediaConsent"];
let testOpen = false;
let identity;

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!testOpen || submit.disabled) return;
  const values = {};
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    values[field] = control.type === "checkbox" ? control.checked :
      control.type === "number" ? control.valueAsNumber : control.value.trim();
  }
  const payload = JSON.stringify(values);
  if (identity?.payload !== payload) identity = { key: crypto.randomUUID(), payload };
  submit.disabled = true;
  status.textContent = "กำลังส่งข้อมูลทดสอบ…";
  try {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, key: identity.key }),
    });
    const result = await response.json();
    if (response.ok && result.test === true && typeof result.reference === "string") {
      status.textContent = "ทดสอบบันทึกสำเร็จ · เลขอ้างอิง " + result.reference;
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

if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  try {
    const response = await fetch(route);
    const settings = await response.json();
    if (response.ok && settings.open === true && settings.test === true) {
      testOpen = true;
      for (const section of testSections) section.disabled = false;
      mediaConsent.closest("fieldset").disabled = false;
      form.elements.namedItem("healthNotes").disabled = true;
      submit.type = "submit";
      submit.disabled = false;
      submit.textContent = "ส่งข้อมูลตัวอย่าง";
      status.textContent = "ทดสอบในเครื่องเท่านั้น · ใช้ข้อมูลสมมติ";
    }
  } catch {
    // Keep the preview closed when the local Worker is unavailable.
  }
}
