import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  try {
    await sql`CREATE TABLE IF NOT EXISTS customer_orders (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, customer_name TEXT NOT NULL, shop TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, total_qty INTEGER NOT NULL DEFAULT 0, total_amount NUMERIC(14,2) NOT NULL DEFAULT 0, telegram_message_id BIGINT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    await sql`CREATE TABLE IF NOT EXISTS customer_order_items (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE, product_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price NUMERIC(12,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0)`;
    const telegramId = String(req.query?.telegram_id || "").trim();
    if (telegramId) {
      if (!/^\d{1,20}$/.test(telegramId)) return res.status(400).json({ ok: false, error: "Telegram ID noto'g'ri" });
      const customers = await sql`SELECT telegram_id, customer_name AS name, shop, address, phone FROM customer_orders WHERE telegram_id = ${telegramId} ORDER BY created_at DESC, id DESC LIMIT 1`;
      if (!customers.length) return res.status(404).json({ ok: false, error: "Mijoz topilmadi" });
      const orders = await sql`SELECT id, total_qty, total_amount, created_at FROM customer_orders WHERE telegram_id = ${telegramId} ORDER BY created_at DESC, id DESC LIMIT 100`;
      const ids = orders.map(x => Number(x.id));
      let items = [];
      if (ids.length) items = await sql`SELECT order_id, product_name, quantity, unit_price, line_total FROM customer_order_items WHERE order_id = ANY(${ids}) ORDER BY id`;
      return res.status(200).json({ ok: true, customer: { ...customers[0], orders: orders.map(order => ({ ...order, items: items.filter(item => Number(item.order_id) === Number(order.id)) })) } });
    }
    const customers = await sql`
      SELECT telegram_id,
        (ARRAY_AGG(customer_name ORDER BY created_at DESC, id DESC))[1] AS name,
        (ARRAY_AGG(phone ORDER BY created_at DESC, id DESC))[1] AS phone,
        (ARRAY_AGG(shop ORDER BY created_at DESC, id DESC))[1] AS shop,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(total_amount),0) AS total_spent,
        MAX(created_at) AS last_order_at
      FROM customer_orders
      GROUP BY telegram_id
      ORDER BY MAX(created_at) DESC
    `;
    return res.status(200).json({ ok: true, customers });
  } catch (error) {
    console.error("ADMIN CUSTOMERS ERROR:", error);
    return res.status(500).json({ ok: false, error: "Mijozlar tarixini yuklashda xatolik" });
  }
}
