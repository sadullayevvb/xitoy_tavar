import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function ensureColumns() {
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_edited BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`;
}

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
        ? await sql`
            SELECT id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
            FROM products WHERE is_deleted = TRUE ORDER BY id DESC
          `
        : await sql`
            SELECT id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
            FROM products WHERE is_deleted = FALSE ORDER BY id DESC
          `;
      return res.status(200).json({ ok: true, products: rows });
    }

    if (req.method === "POST") {
      const name = String(req.body?.name || "").trim();
      const photoFileId = String(req.body?.photo_file_id || "").trim();
      if (!name || !photoFileId) return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });

      const messageId = -Date.now();
      const rows = await sql`
        INSERT INTO products (channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, updated_at)
        VALUES ('admin', ${messageId}, ${name}, ${photoFileId}, FALSE, TRUE, CURRENT_TIMESTAMP)
        RETURNING id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
      `;
      return res.status(201).json({ ok: true, product: rows[0] });
    }

    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Mahsulot ID noto'g'ri" });

    if (req.method === "PATCH") {
      if (String(req.body?.action || "") === "restore") {
        const rows = await sql`
          UPDATE products
          SET is_deleted = FALSE, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
        `;
        if (!rows.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
        return res.status(200).json({ ok: true, product: rows[0] });
      }

      const current = await sql`SELECT id, name, photo_file_id FROM products WHERE id = ${id} LIMIT 1`;
      if (!current.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });

      const name = String(req.body?.name ?? current[0].name).trim();
      const photoFileId = String(req.body?.photo_file_id ?? current[0].photo_file_id).trim();
      if (!name || !photoFileId) return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });

      const rows = await sql`
        UPDATE products
        SET name = ${name}, photo_file_id = ${photoFileId}, admin_edited = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
      `;
      return res.status(200).json({ ok: true, product: rows[0] });
    }

    if (req.method === "DELETE") {
      const rows = await sql`
        UPDATE products
        SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, channel_id, message_id, name, photo_file_id, is_deleted, admin_edited, created_at, updated_at, deleted_at
      `;
      if (!rows.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
      return res.status(200).json({ ok: true, product: rows[0] });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("ADMIN PRODUCTS ERROR:", error);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
}
