import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;

  try {
    await sql`CREATE TABLE IF NOT EXISTS customer_orders (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL,
      customer_name TEXT NOT NULL, shop TEXT NOT NULL, address TEXT NOT NULL,
      phone TEXT NOT NULL, total_qty INTEGER NOT NULL DEFAULT 0,
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      telegram_message_id BIGINT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
    await sql`CREATE TABLE IF NOT EXISTS customer_order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
      product_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(14,2) NOT NULL DEFAULT 0
    )`;

    const telegramId = String(req.query?.telegram_id || "").trim();
    if (telegramId) {
      if (!/^\\d{1,20}$/.test(telegramId)) return res.status(400).json({ ok: false, error: "Telegram ID noto'g'ri" });
      const customerRows = await sql`SELECT telegram_id, customer_name AS name, shop, address, phone FROM customer_orders WHERE telegram_id = ${telegramId}::bigint ORDER BY created_at DESC, id DESC LIMIT 1`;
      if (!customerRows.length) return res.status(404).json({ ok: false, error: "Mijoz topilmadi" });
      const orders = await sql`SELECT id, total_qty, total_amount, created_at FROM customer_orders WHERE telegram_id = ${telegramId}::bigint ORDER BY created_at DESC, id DESC LIMIT 100`;
      const history = [];
      for (const order of orders) {
        const items = await sql`SELECT product_name, quantity, unit_price, line_total FROM customer_order_items WHERE order_id = ${order.id} ORDER BY id`;
        history.push({ ...order, items });
      }
      return res.status(200).json({ ok: true, customer: { ...customerRows[0], orders: history } });
    }

    const rows = await sql`SELECT telegram_id, customer_name, phone, shop, total_amount, created_at FROM customer_orders ORDER BY created_at DESC, id DESC`;
    const map = new Map();
    for (const row of rows) {
      const id = String(row.telegram_id);
      if (!map.has(id)) map.set(id, {
        telegram_id: id, name: row.customer_name, phone: row.phone, shop: row.shop,
        order_count: 0, total_spent: 0, last_order_at: row.created_at
      });
      const customer = map.get(id);
      customer.order_count += 1;
      customer.total_spent += Number(row.total_amount || 0);
    }
    return res.status(200).json({ ok: true, customers: Array.from(map.values()) });
  } catch (error) {
    console.error("ADMIN CUSTOMERS ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error || "Mijozlar tarixini yuklashda xatolik").slice(0, 300)
    });
  }
}
