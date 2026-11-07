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
    const { items, initData, customer } = req.body || {};
    if (!BOT_TOKEN) return fail(res, 500, "Bot sozlanmagan");
    const customerInfo = {
      name: String(customer?.name || "").trim().slice(0, 120),
      shop: String(customer?.shop || "").trim().slice(0, 120),
      address: String(customer?.address || "").trim().slice(0, 300),
      phone: String(customer?.phone || "").trim().slice(0, 30)
    };
    if (!customerInfo.name || !customerInfo.shop || !customerInfo.address || !customerInfo.phone) return fail(res, 400, "Ism, do‘kon nomi, manzil va telefonni to‘ldiring");

    let user = { id: 0, username: "Sayt orqali" };
    if (initData) {
      const { createHmac, timingSafeEqual } = await import("node:crypto");
      const params = new URLSearchParams(initData);
      const receivedHash = params.get("hash");
      if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return fail(res, 401, "Telegram ma'lumoti noto'g'ri");
      params.delete("hash");
      const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => `${key}=${value}`).join("\\n");
      const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
      const calculatedHash = createHmac("sha256", secret).update(dataCheckString).digest();
      const receivedHashBuffer = Buffer.from(receivedHash, "hex");
      if (receivedHashBuffer.length !== calculatedHash.length || !timingSafeEqual(calculatedHash, receivedHashBuffer)) return fail(res, 401, "Telegram tekshiruvidan o'tmadi");
      const authDate = Number(params.get("auth_date"));
      if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return fail(res, 401, "Mini Appni qayta oching");
      user = JSON.parse(params.get("user") || "{}");
      if (!user.id) return fail(res, 401, "Telegram foydalanuvchisi topilmadi");
      await sql`CREATE TABLE IF NOT EXISTS user_profiles (
        telegram_id BIGINT PRIMARY KEY, phone TEXT NOT NULL DEFAULT '', first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', avatar_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
      const profileRows = await sql`SELECT phone, first_name, last_name FROM user_profiles WHERE telegram_id = ${String(user.id)} LIMIT 1`;
      const profile = profileRows[0] || {};
    }

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
    const adminIds = String(process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean);
    const adminChatId = adminIds[0];
    if (!adminChatId) return fail(res, 500, "Admin Telegram ID sozlanmagan. ADMIN_TELEGRAM_IDS ni kiriting.");

    pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 10000 });
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("CREATE TABLE IF NOT EXISTS customer_orders (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, customer_name TEXT NOT NULL, shop TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, total_qty INTEGER NOT NULL DEFAULT 0, total_amount NUMERIC(14,2) NOT NULL DEFAULT 0, telegram_message_id BIGINT, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await client.query("ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'legacy'");
    await client.query("CREATE TABLE IF NOT EXISTS customer_order_items (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE, product_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price NUMERIC(12,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0)");
    const { rows: products } = await client.query(
      `SELECT id, name, stock_qty, price, is_deleted FROM products WHERE id = ANY($1::int[]) FOR UPDATE`,
      [ids]
    );
    if (products.length !== ids.length || products.some(p => p.is_deleted)) throw Object.assign(new Error("Mahsulotlardan biri topilmadi"), { statusCode: 400 });
    const reserved = await client.query(
      `SELECT oi.product_id, SUM(oi.quantity)::int AS qty
       FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id
       WHERE o.status='pending' AND oi.product_id = ANY($1::int[])
       GROUP BY oi.product_id`, [ids]
    );
    const reservedMap = new Map(reserved.rows.map(x => [Number(x.product_id), Number(x.qty)]));
    const insufficient = products.filter(p => Number(p.stock_qty) - (reservedMap.get(Number(p.id)) || 0) < quantities.get(Number(p.id)));
    if (insufficient.length) {
      const names = insufficient.map(p => `${p.name} (bo‘sh qoldiq: ${Math.max(0, Number(p.stock_qty) - (reservedMap.get(Number(p.id)) || 0))})`).join(", ");
      throw Object.assign(new Error(`Qoldiq yetarli emas: ${names}`), { statusCode: 409 });
    }

    const total = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
    const totalPrice = products.reduce((sum, product) => sum + Number(product.price || 0) * quantities.get(Number(product.id)), 0);
    const savedOrder = await client.query(
      "INSERT INTO customer_orders (telegram_id, customer_name, shop, address, phone, total_qty, total_amount, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id",
      [String(user.id), customerInfo.name, customerInfo.shop, customerInfo.address, customerInfo.phone, total, totalPrice]
    );
    const savedOrderId = savedOrder.rows[0].id;
    for (const product of products) {
      const qty = quantities.get(Number(product.id));
      const unitPrice = Number(product.price || 0);
      await client.query("INSERT INTO customer_order_items (order_id, product_id, product_name, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6)", [savedOrderId, product.id, product.name, qty, unitPrice, unitPrice * qty]);
    }
    const lines = products.map((product, index) => `${index + 1}. ${product.name} — ${quantities.get(Number(product.id))} dona × $${Number(product.price || 0).toFixed(2)} = $${(Number(product.price || 0) * quantities.get(Number(product.id))).toFixed(2)}`);
    const message = [
      `🛒 YANGI ZAKAZ #${savedOrderId}`, "",
      `👤 Mijoz: ${customerInfo.name}`, `🏪 Do‘kon: ${customerInfo.shop}`,
      `📍 Manzil: ${customerInfo.address}`, `📱 Telefon: ${customerInfo.phone}`,
      `🔗 Manba: ${Number(user.id) ? (user.username ? "@" + user.username : "Telegram Mini App") : "Sayt (Telegram loginisiz)"}`,
      `🆔 Telegram ID: ${user.id}`, "", "📦 Mahsulotlar:", ...lines, "",
      `📊 Jami: ${total} dona`, `💵 Umumiy summa: $${totalPrice.toFixed(2)}`,
      "", "⏳ Holat: tasdiqlash kutilmoqda"
    ].join("\n");
    const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text: message, reply_markup: { inline_keyboard: [[
        { text: "✅ Tasdiqlash", callback_data: `order_confirm:${savedOrderId}` },
        { text: "❌ Bekor qilish", callback_data: `order_cancel:${savedOrderId}` },
        { text: "✏️ Tahrirlash", callback_data: `order_edit:${savedOrderId}` }
      ]] } })
    });
    const result = await telegramResponse.json();
    if (!result.ok) throw Object.assign(new Error("Zakaz admin shaxsiy chatiga yuborilmadi. Botga /start yuboring va ADMIN_TELEGRAM_IDS ni tekshiring."), { statusCode: 502 });
    await client.query("UPDATE customer_orders SET telegram_message_id=$1 WHERE id=$2", [result.result?.message_id || null, savedOrderId]);
    await client.query("COMMIT");
    inTransaction = false;
    return res.status(200).json({ ok: true, order_id: savedOrderId, status: "pending", message: "Buyurtma admin tasdig‘iga yuborildi" });
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
