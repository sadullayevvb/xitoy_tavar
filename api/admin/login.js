import { credentialsMatch, makeAdminToken } from "../../lib/adminAuth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { login, password } = req.body || {};

    if (!credentialsMatch(login, password)) {
      return res.status(401).json({ ok: false, error: "Login yoki parol noto'g'ri" });
    }

    return res.status(200).json({
      ok: true,
      token: makeAdminToken()
    });
  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);
    return res.status(500).json({ ok: false, error: "Server xatosi" });
  }
}
