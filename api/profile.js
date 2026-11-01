import { neon } from "@neondatabase/serverless";
import { createHmac, timingSafeEqual } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;
const sql = neon(DATABASE_URL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
}
function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData || typeof initData !== "string") return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? user : null;
  } catch {
    return null;
  }
}
async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS user_profiles (
    telegram_id BIGINT PRIMARY KEY,
    phone TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    avatar_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  try {
    await ensureTable();
    const body = req.body || {};
    const user = verifyInitData(body.initData);
    if (!user) return fail(res, 401, "Telegram ma'lumoti tasdiqlanmadi. Mini Appni Telegram ichidan qayta oching.");
    await sql`
      INSERT INTO user_profiles (telegram_id, first_name, last_name, username)
      VALUES (${String(user.id)}, ${String(user.first_name || "")}, ${String(user.last_name || "")}, ${String(user.username || "")})
      ON CONFLICT (telegram_id) DO UPDATE SET
        username = EXCLUDED.username,
        updated_at = CURRENT_TIMESTAMP
    `;
    if (body.action === "get") {
      const rows = await sql`SELECT telegram_id, phone, first_name, last_name, username, avatar_data, updated_at FROM user_profiles WHERE telegram_id = ${String(user.id)} LIMIT 1`;
      await sql`CREATE TABLE IF NOT EXISTS customer_orders (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, customer_name TEXT NOT NULL, shop TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, total_qty INTEGER NOT NULL DEFAULT 0, total_amount NUMERIC(14,2) NOT NULL DEFAULT 0, telegram_message_id BIGINT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
      await sql`CREATE TABLE IF NOT EXISTS customer_order_items (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE, product_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price NUMERIC(12,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0)`;
      const orders = await sql`SELECT id, customer_name, shop, total_qty, total_amount, created_at FROM customer_orders WHERE telegram_id = ${String(user.id)} ORDER BY created_at DESC, id DESC LIMIT 100`;
      const orderIds = orders.map(x => Number(x.id));
      let items = [];
      if (orderIds.length) items = await sql`SELECT order_id, product_name, quantity, unit_price, line_total FROM customer_order_items WHERE order_id = ANY(${orderIds}) ORDER BY id`;
      const history = orders.map(order => ({...order, items: items.filter(item => Number(item.order_id) === Number(order.id))}));
      return res.status(200).json({ ok: true, profile: rows[0], orders: history });
    }
    if (body.action === "save") {
      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      if (name.length < 2 || name.length > 80) return fail(res, 400, "Ism 2–80 ta belgidan iborat bo'lsin");
      if (!/^\+?[0-9()\-\s]{7,24}$/.test(phone) || phone.replace(/\D/g, "").length < 7) return fail(res, 400, "Telefon raqamini to'g'ri kiriting");
      let avatar = body.avatar_data;
      if (avatar !== undefined && avatar !== null && avatar !== "") {
        if (typeof avatar !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 1500000) {
          return fail(res, 400, "Rasm JPG, PNG yoki WEBP bo'lsin va 1 MB atrofidan oshmasin");
        }
      } else {
        avatar = undefined;
      }
      if (body.remove_avatar === true) {
        await sql`UPDATE user_profiles SET first_name = ${name}, last_name = '', phone = ${phone}, avatar_data = NULL, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ${String(user.id)}`;
      } else if (avatar !== undefined) {
        await sql`UPDATE user_profiles SET first_name = ${name}, last_name = '', phone = ${phone}, avatar_data = ${avatar}, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ${String(user.id)}`;
      } else {
        await sql`UPDATE user_profiles SET first_name = ${name}, last_name = '', phone = ${phone}, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ${String(user.id)}`;
      }
      const rows = await sql`SELECT telegram_id, phone, first_name, last_name, username, avatar_data, updated_at FROM user_profiles WHERE telegram_id = ${String(user.id)} LIMIT 1`;
      return res.status(200).json({ ok: true, profile: rows[0] });
    }
    return fail(res, 400, "Noto'g'ri amal");
  } catch (error) {
    console.error("PROFILE API ERROR:", error);
    return fail(res, 500, "Profilni saqlashda xatolik");
  }
}
