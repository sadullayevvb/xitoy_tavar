import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS catalog_products (
      id SERIAL PRIMARY KEY,
      source_product_id INTEGER UNIQUE NULL,
      name TEXT NOT NULL,
      photo_file_id TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL
    )
  `;

  await sql`
    INSERT INTO catalog_products (source_product_id, name, photo_file_id)
    SELECT p.id, p.name, p.photo_file_id
    FROM products p
    LEFT JOIN catalog_products c ON c.source_product_id = p.id
    WHERE c.id IS NULL
  `;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!requireAdmin(req, res)) return;

  try {
    await ensureTables();
    const id = Number(req.query?.id || req.body?.id || 0);

    if (req.method === "GET") {
      const trash = String(req.query?.trash || "0") === "1";
      const rows = trash
        ? await sql`
            SELECT id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
            FROM catalog_products
            WHERE is_deleted = TRUE
            ORDER BY id DESC
          `
        : await sql`
            SELECT id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
            FROM catalog_products
            ORDER BY id DESC
          `;

      return res.status(200).json({ ok: true, products: rows });
    }

    if (req.method === "POST") {
      const name = String(req.body?.name || "").trim();
      const photoFileId = String(req.body?.photo_file_id || "").trim();

      if (!name || !photoFileId) {
        return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });
      }

      const rows = await sql`
        INSERT INTO catalog_products (source_product_id, name, photo_file_id)
        VALUES (NULL, ${name}, ${photoFileId})
        RETURNING id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
      `;

      return res.status(201).json({ ok: true, product: rows[0] });
    }

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Mahsulot ID noto'g'ri" });
    }

    if (req.method === "PATCH") {
      if (String(req.body?.action || "") === "restore") {
        const rows = await sql`
          UPDATE catalog_products
          SET is_deleted = FALSE,
              deleted_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
        `;
        if (!rows.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });
        return res.status(200).json({ ok: true, product: rows[0] });
      }

      const current = await sql`
        SELECT id, name, photo_file_id
        FROM catalog_products
        WHERE id = ${id}
        LIMIT 1
      `;
      if (!current.length) return res.status(404).json({ ok: false, error: "Mahsulot topilmadi" });

      const name = String(req.body?.name ?? current[0].name).trim();
      const photoFileId = String(req.body?.photo_file_id ?? current[0].photo_file_id).trim();
      if (!name || !photoFileId) return res.status(400).json({ ok: false, error: "Nomi va rasm kerak" });

      const rows = await sql`
        UPDATE catalog_products
        SET name = ${name},
            photo_file_id = ${photoFileId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
      `;

      return res.status(200).json({ ok: true, product: rows[0] });
    }

    if (req.method === "DELETE") {
      const rows = await sql`
        UPDATE catalog_products
        SET is_deleted = TRUE,
            deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING id, source_product_id, name, photo_file_id, is_deleted, created_at, updated_at, deleted_at
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
