const route = "/api/events/move-kids-2026/registration";
const fields = {
  fullName: 120, nickname: 60, phone: 25, emergencyName: 120,
  emergencyPhone: 25, emergencyRelationship: 60,
};
const acknowledgements = ["termsAccepted", "safetyAccepted", "equipmentAccepted"];
const experiences = new Set(["regular", "some", "new"]);

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.key)) return null;
  const allowed = new Set([...Object.keys(fields), "key", "age", "experience", ...acknowledgements, "mediaConsent"]);
  if (Object.keys(body).some(name => !allowed.has(name)) || typeof body.mediaConsent !== "boolean") return null;
  const data = {};
  for (const [name, limit] of Object.entries(fields)) {
    if (typeof body[name] !== "string") return null;
    data[name] = body[name].trim();
    if (!data[name] || data[name].length > limit) return null;
  }
  for (const name of ["phone", "emergencyPhone"]) {
    data[name] = data[name].replace(/[\s().-]/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(data[name])) return null;
  }
  if (!Number.isInteger(body.age) || body.age < 0 || body.age > 120) return null;
  if (!experiences.has(body.experience) || acknowledgements.some(name => body[name] !== true)) return null;
  return { ...data, age: body.age, experience: body.experience, mediaConsent: body.mediaConsent, ...Object.fromEntries(acknowledgements.map(name => [name, true])) };
}

async function register(request, db, test) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply({ error: "INVALID" }, 415);
  }
  if (!request.body) return reply({ error: "INVALID" }, 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = "", size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      return reply({ error: "INVALID" }, 413);
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let body;
  try { body = JSON.parse(raw); } catch { return reply({ error: "INVALID" }, 400); }
  const data = validate(body);
  if (!data) return reply({ error: "INVALID" }, 400);

  const reference = "MK-" + crypto.randomUUID().slice(0, 13).replace("-", "").toUpperCase();
  const payload = JSON.stringify(data);
  await db.prepare(`
    INSERT INTO move_kids_registrations (request_key, reference, payload)
    VALUES (?1, ?2, ?3)
    ON CONFLICT (request_key) DO NOTHING
  `).bind(body.key.toLowerCase(), reference, payload).run();
  const saved = await db.prepare(`
    SELECT reference, payload FROM move_kids_registrations WHERE request_key = ?1
  `).bind(body.key.toLowerCase()).first();
  if (!saved || saved.payload !== payload) return reply({ error: "RETRY_CONFLICT" }, 409);
  return reply({ reference: saved.reference, test });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== route) return env.ASSETS.fetch(request);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const test = isLocal && env.EVENTS_TEST_MODE === "1";
    const production = url.origin === "https://norxcraftingmovement.com" && env.EVENTS_REGISTRATION_OPEN === "1";
    if ((!test && !production) || !env.EVENTS_DB || (!test && !env.REGISTRATION_LIMITER)) {
      return reply({ open: false }, request.method === "GET" ? 200 : 403);
    }
    if (request.method === "GET") {
      try {
        await env.EVENTS_DB.prepare("SELECT 1 FROM move_kids_registrations LIMIT 1").first();
        return reply({ open: true, test });
      } catch {
        return reply({ open: false }, 503);
      }
    }
    if (request.method !== "POST") return reply({ error: "METHOD" }, 405);
    if (request.headers.get("Origin") !== url.origin) return reply({ error: "ORIGIN" }, 403);
    try {
      if (!test) {
        const ip = request.headers.get("CF-Connecting-IP");
        if (!ip) return reply({ error: "UNAVAILABLE" }, 503);
        const { success } = await env.REGISTRATION_LIMITER.limit({ key: "move-kids:" + ip });
        if (!success) return reply({ error: "RATE_LIMIT" }, 429);
      }
      return await register(request, env.EVENTS_DB, test);
    } catch {
      return reply({ error: "UNAVAILABLE" }, 503);
    }
  },
};
