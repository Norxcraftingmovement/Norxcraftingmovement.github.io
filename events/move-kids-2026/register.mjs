const route = "/api/events/move-kids-2026/registration";
const form = document.querySelector(".registration-form");
const status = document.querySelector(".registration-status");
const closed = document.querySelector("#registration-closed");
const success = document.querySelector("#registration-success");
const feedback = document.querySelector("#form-feedback");
const cta = document.querySelector("#event-register-cta");
const submit = form.querySelector("button");
const sections = [...form.querySelectorAll("fieldset")];
const fields = ["fullName", "nickname", "age", "phone", "emergencyName", "emergencyPhone",
  "emergencyRelationship", "experience", "termsAccepted", "safetyAccepted", "equipmentAccepted",
  "mediaConsent"];
// Isolated browser QA: no remote submission; production never takes this path.
const demo = location.origin === "https://feature-event-registration-ux-norx-crafting-movement.norx-craftingmovement.workers.dev";
let registrationOpen = false;
let identity;
let completed = false;
let submitting = false;
let testMode = false;

function busy(value) {
  submitting = value;
  for (const section of sections) section.disabled = value || !registrationOpen || completed;
  submit.disabled = value || !registrationOpen || completed;
  submit.textContent = value ? "กำลังส่งข้อมูล…" : testMode ? "ทดสอบส่งข้อมูล" : "ยืนยันการสมัคร";
}
function notice(message) {
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.focus();
}
function showClosed(message = "ยังไม่เปิดรับสมัคร") {
  registrationOpen = false;
  status.classList.remove("is-open");
  status.textContent = message;
  cta.textContent = "ดูการรับสมัคร";
  closed.hidden = false;
  if (!submitting) form.hidden = true;
}
function showOpen(test) {
  registrationOpen = true;
  testMode = test;
  status.classList.add("is-open");
  status.textContent = test ? "โหมดทดสอบ — ใช้ข้อมูลสมมติเท่านั้น ไม่บันทึกจริง" : "เปิดรับสมัคร";
  closed.hidden = true;
  form.hidden = false;
  cta.textContent = "สมัครเข้าร่วมวิ่ง";
  submit.type = "submit";
  busy(false);
}
function validPhone(value) {
  return /^\+?[0-9]{7,15}$/.test(value.replace(/[\s().-]/g, ""));
}
for (const name of ["phone", "emergencyPhone"]) {
  const control = form.elements.namedItem(name);
  control.addEventListener("input", () => control.setCustomValidity(""));
}
for (const name of ["fullName", "nickname", "emergencyName", "emergencyRelationship"]) {
  const control = form.elements.namedItem(name);
  control.addEventListener("input", () => control.setCustomValidity(""));
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!registrationOpen || completed || submitting) return;
  feedback.hidden = true;
  for (const name of ["fullName", "nickname", "emergencyName", "emergencyRelationship"]) {
    const control = form.elements.namedItem(name);
    if (!control.value.trim()) { control.setCustomValidity("กรุณากรอกข้อมูลในช่องนี้"); control.reportValidity(); return; }
  }
  for (const name of ["phone", "emergencyPhone"]) {
    const control = form.elements.namedItem(name);
    if (!validPhone(control.value)) { control.setCustomValidity("กรุณาตรวจสอบหมายเลขโทรศัพท์"); control.reportValidity(); return; }
  }
  if (!form.reportValidity()) return;
  const values = {};
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    values[field] = control.type === "checkbox" ? control.checked :
      control.type === "number" ? control.valueAsNumber : control.value.trim();
  }
  const payload = JSON.stringify(values);
  if (identity?.payload !== payload) identity = { key: crypto.randomUUID(), payload };
  busy(true);
  try {
    const response = demo ? Response.json({reference:"DEMO-ONLY",test:true}) : await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, key: identity.key }),
    });
    const result = await response.json();
    if (response.ok && typeof result.reference === "string") {
      completed = true;
      form.reset();
      identity = undefined;
      form.hidden = true;
      status.hidden = true;
      success.hidden = false;
      const heading = success.querySelector("h3");
      if (result.test) {
        heading.textContent = "ทดสอบลงทะเบียนสำเร็จ!";
        document.querySelector("#success-note").textContent = "ข้อมูลตัวอย่าง — ไม่ได้บันทึกผู้สมัครจริง";
      }
      heading.focus();
      return;
    }
    if (response.status === 403 && (result.error === "CLOSED" || result.open === false)) {
      // Preserve the form in case someone needs to copy their input.
      showClosed("ปิดรับสมัครแล้ว");
      notice("ขณะนี้ปิดรับสมัครแล้ว ข้อมูลที่กรอกยังอยู่ แต่ส่งไม่ได้");
    } else if (response.status === 429) {
      notice("มีการส่งข้อมูลถี่เกินไป กรุณารอหนึ่งนาทีแล้วลองส่งอีกครั้ง");
    } else {
      notice(result.error === "INVALID" ? "กรุณาตรวจข้อมูลที่กรอกและการรับทราบเงื่อนไข" : "บันทึกไม่สำเร็จ ข้อมูลยังอยู่ ลองส่งอีกครั้งได้");
    }
  } catch {
    notice("ติดต่อระบบไม่ได้ ข้อมูลที่กรอกยังอยู่ ลองส่งอีกครั้งได้");
  } finally {
    busy(false);
  }
});

try {
  if (demo) {
    showOpen(true);
  } else {
    const response = await fetch(route, {cache:"no-store"});
    const settings = await response.json();
    if (response.ok && settings.open === true) showOpen(settings.test === true);
    else showClosed();
  }
} catch {
  showClosed("ไม่สามารถตรวจสอบการรับสมัครได้ในขณะนี้");
}
