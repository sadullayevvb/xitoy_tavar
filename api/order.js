import { Pool } from "@neondatabase/serverless";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);
const BOT_TOKEN = process.env.BOT_TOKEN;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");

  let pool;
  let client;
  let inTransaction = false;

  try {
    const { items, initData } = req.body || {};
    if (!BOT_TOKEN || !initData) return fail(res, 401, "Telegram orqali kiring");

    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");
    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return fail(res, 401, "Telegram ma'lumoti noto'g'ri");
    params.delete("hash");
    const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => `${key}=${value}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calculatedHash = createHmac("sha256", secret).update(dataCheckString).digest();
    const receivedHashBuffer = Buffer.from(receivedHash, "hex");
    if (receivedHashBuffer.length !== calculatedHash.length || !timingSafeEqual(calculatedHash, receivedHashBuffer)) return fail(res, 401, "Telegram tekshiruvidan o'tmadi");

    const authDate = Number(params.get("auth_date"));
    if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return fail(res, 401, "Mini Appni qayta oching");

    const user = JSON.parse(params.get("user") || "{}");
    if (!user.id) return fail(res, 401, "Telegram foydalanuvchisi topilmadi");

    if (!Array.isArray(items) || items.length === 0 || items.length > 100) return fail(res, 400, "Savat bo'sh");
    const quantities = new Map();
    for (const item of items) {
      const id = Number(item.id);
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return fail(res, 400, "Noto'g'ri mahsulot yoki miqdor");
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    }
    const ids = [...quantities.keys()];

    const settings = await sql`SELECT value FROM bot_settings WHERE key = 'order_group_chat_id' LIMIT 1`;
    if (!settings.length) return fail(res, 500, "Buyurtma guruhi sozlanmagan");

    pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 10000 });
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const { rows: products } = await client.query(
      `SELECT id, name, stock_qty, is_deleted FROM products WHERE id = ANY($1::int[]) FOR UPDATE`,
      [ids]
    );

    if (products.length !== ids.length || products.some(p => p.is_deleted)) {
      throw Object.assign(new Error("Mahsulotlardan biri topilmadi"), { statusCode: 400 });
    }

    const insufficient = products.filter(p => p.stock_qty < quantities.get(Number(p.id)));
    if (insufficient.length) {
      const names = insufficient.map(p => `${p.name} (qoldiq: ${p.stock_qty})`).join(", ");
      throw Object.assign(new Error(`Qoldiq yetarli emas: ${names}`), { statusCode: 409 });
    }

    for (const product of products) {
      const qty = quantities.get(Number(product.id));
      await client.query("UPDATE products SET stock_qty = stock_qty - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND stock_qty >= $1", [qty, product.id]);
    }

    const total = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
    const lines = products.map((product, index) => `${index + 1}. ${product.name} — ${quantities.get(Number(product.id))} dona`);
    const message = [
      "🛒 YANGI ZAKAZ",
      "",
      `👤 Mijoz: ${user.first_name || "Noma'lum"} ${user.last_name || ""}`,
      `🔗 Username: ${user.username ? "@" + user.username : "Yo'q"}`,
      `🆔 Telegram ID: ${user.id}`,
      "",
      "📦 Mahsulotlar:",
      ...lines,
      "",
      `📊 Jami: ${total} dona`
    ].join("\n");

    const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: settings[0].value, text: message })
    });
    const result = await telegramResponse.json();
    if (!result.ok) throw Object.assign(new Error("Buyurtmani guruhga yuborib bo'lmadi"), { statusCode: 502 });

    await client.query("COMMIT");
    inTransaction = false;
    return res.status(200).json({ ok: true, message: "Buyurtma qabul qilindi" });
  } catch (error) {
    if (client && inTransaction) {
      try { await client.query("ROLLBACK"); } catch (_) {}
    }
    console.error("ORDER ERROR:", error);
    return fail(res, error.statusCode || 500, error.message || "Server error");
  } finally {
    if (client) client.release();
    if (pool) {
      try { await pool.end(); } catch (_) {}
    }
  }
}
