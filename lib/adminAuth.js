import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || "";

export function credentialsMatch(login, password) {
  return String(login || "") === ADMIN_LOGIN && String(password || "") === ADMIN_PASSWORD;
}

export function makeAdminToken() {
  if (!ADMIN_TOKEN_SECRET) throw new Error("ADMIN_TOKEN_SECRET is not configured");

  const payload = JSON.stringify({
    role: "admin",
    exp: Date.now() + 24 * 60 * 60 * 1000
  });

  const body = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

export function verifyAdminToken(token) {
  try {
    if (!token || !ADMIN_TOKEN_SECRET) return false;

    const [body, signature] = token.split(".");
    if (!body || !signature) return false;

    const expected = createHmac("sha256", ADMIN_TOKEN_SECRET)
      .update(body)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

export function getAdminToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return req.body?.adminToken || req.query?.adminToken || "";
}

export function requireAdmin(req, res) {
  if (!verifyAdminToken(getAdminToken(req))) {
    res.status(401).json({ ok: false, error: "Admin huquqi kerak" });
    return false;
  }
  return true;
}
