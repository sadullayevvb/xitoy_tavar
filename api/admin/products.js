import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

async function ensureColumns() {
  await sql`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_edited BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0`;
}

const returning = sql`id, channel_id, message_id, name, photo_file_id, stock_qty, is_deleted, admin_edited, created_at, updated_at, deleted_at`;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!requireAdmin(req, res)) return;
  try {
    await ensureColumns();
    const id = Number(req.query?.id || req.body?.id || 0);

    if (req.method === "GET") {
      const trash = String(req.query?.trash || "0") === "1";
      const rows = trash
        ? await sql`SELECT p.id, p.channel_id, p.message_id, p.name, p.photo_file_id, p.stock_qty, p.category_id, c.name AS category_name, p.is_deleted, p.admin_edited, p.created_at, p.updated_at, p.deleted_at FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_deleted = TRUE ORDER BY p.id DESC`
        : await sql`SELECT p.id, p.channel_id, p.message_id, p.name, p.photo_file_id, p.stock_qty, p.category_id, c.name AS category_name, p.is_deleted, p.admin_edited, p.created_at, p.updated_at, p.deleted_at FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_deleted = FALSE ORDER BY p.id DESC`;
      return res.status(200).json({ ok: true, products: rows });
    }

    if (req.method === "POST") {
      const name = String(req.body?.name || "").trim();
      const photoFileId = String(req.body?.photo_file_id || "").trim();
      const stockQty = Number(req.body?.stock_qty ?? 0);
      let categoryId = req.body?.category_id == null || req.body?.category_id === '' ? null : Number(req.body.category_id);
      if (!name || !photoFileId) return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });
      if (categoryId === null) {
        const rules = [
          ["Ilgak va osmalar", "(вешал|плечик|hanger|vishel|veshal|ilgich|kiyim ilgich|ilgak|крюч|креплен|липуч)"],
          ["Unitaz vanna", "(ершик|ёршик|ершики|ёршики|yorshik|yorsh|ershik|ерш|вантуз|avntuz|vantuz|унитаз|unitaz|ванна|vanna|туалет|toilet|wc|щетк.*(унитаз|туалет)|brush.*(toilet|wc))"],
          ["Korzinalar", "(korzina|корзин|basket)"],
          ["Oshxona buyumlari", "(oshxona|кухн|кухон|нож|кухонн)"],
          ["Tozalash vositalari", "(tozal|щетк|губк|швабр)"],
          ["Aksessuarlar", "(aksessuar|брелок|чехол)"],
          ["Uy-ro‘zg‘or buyumlari", "(uy|дом|хранен)"]
        ];
        for (const [categoryName, pattern] of rules) {
          const matched = await sql`SELECT id FROM categories WHERE name = ${categoryName} LIMIT 1`;
          if (matched.length) {
            const found = await sql`SELECT ${name} ~* ${pattern} AS matched`;
            if (found[0]?.matched) { categoryId = matched[0].id; break; }
          }
        }
        if (categoryId === null) {
          const other = await sql`SELECT id FROM categories WHERE name = 'Boshqa' LIMIT 1`;
          if (other.length) categoryId = other[0].id;
        }
      }
      if (!Number.isSafeInteger(stockQty) || stockQty < 0) return res.status(400).json({ ok: false, error: "Qoldiq noto'g'ri" });
      const messageId = -Date.now();
      const rows = await sql`
        INSERT INTO products (channel_id, message_id, name, photo_file_id, stock_qty, category_id, is_deleted, admin_edited, updated_at)
        VALUES ('admin', ${messageId}, ${name}, ${photoFileId}, ${stockQty}, ${categoryId}, FALSE, TRUE, CURRENT_TIMESTAMP)
        RETURNING id, channel_id, message_id, name, photo_file_id, stock_qty, is_deleted, admin_edited, created_at, updated_at, deleted_at
      `;
      return res.status(201).json({ ok: true, product: rows[0] });
    }

    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Mahsulot ID noto'g'ri" });

    if (req.method === "PATCH") {
      if (String(req.body?.action || "") === "restore") {
        const rows = await sql`
          UPDATE products SET is_deleted = FALSE, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING id, channel_id, message_id, name, photo_file_id, stock_qty, is_deleted, admin_edited, created_at, updated_at, deleted_at
        `;
        if (!rows.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
        return res.status(200).json({ ok: true, product: rows[0] });
      }

      const current = await sql`SELECT id, name, photo_file_id, stock_qty, category_id FROM products WHERE id = ${id} LIMIT 1`;
      if (!current.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
      const name = String(req.body?.name ?? current[0].name).trim();
      const photoFileId = String(req.body?.photo_file_id ?? current[0].photo_file_id).trim();
      const stockQty = Number(req.body?.stock_qty ?? current[0].stock_qty);
      const categoryId = req.body?.category_id === undefined ? current[0].category_id : (req.body.category_id === null || req.body.category_id === '' ? null : Number(req.body.category_id));
      if (!name || !photoFileId) return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });
      if (!Number.isSafeInteger(stockQty) || stockQty < 0) return res.status(400).json({ ok: false, error: "Qoldiq noto'g'ri" });
      const rows = await sql`
        UPDATE products SET name = ${name}, photo_file_id = ${photoFileId}, stock_qty = ${stockQty}, category_id = ${categoryId}, admin_edited = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, channel_id, message_id, name, photo_file_id, stock_qty, is_deleted, admin_edited, created_at, updated_at, deleted_at
      `;
      return res.status(200).json({ ok: true, product: rows[0] });
    }

    if (req.method === "DELETE") {
      const permanent = String(req.body?.action || "") === "permanent_delete";
      if (permanent) {
        const rows = await sql`DELETE FROM products WHERE id = ${id} AND is_deleted = TRUE RETURNING id, name`;
        if (!rows.length) return res.status(404).json({ ok: false, error: "Chiqindidagi mahsulot topilmadi" });
        return res.status(200).json({ ok: true, deleted: rows[0] });
      }
      const rows = await sql`UPDATE products SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id} RETURNING id, channel_id, message_id, name, photo_file_id, stock_qty, is_deleted, admin_edited, created_at, updated_at, deleted_at`;
      if (!rows.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
      return res.status(200).json({ ok: true, product: rows[0] });
    }
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("ADMIN PRODUCTS ERROR:", error);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
}
