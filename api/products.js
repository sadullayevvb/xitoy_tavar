import { neon } from "@neondatabase/serverless";

const DATABASE_URL =
  process.env.DATABASE_URL || process.env.POSTGRES_URL;

const sql = neon(DATABASE_URL);

async function ensureCatalog() {
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    await ensureCatalog();

    const products = await sql`
      SELECT
        id,
        name,
        photo_file_id,
        created_at,
        updated_at
      FROM catalog_products
      WHERE is_deleted = FALSE
      ORDER BY id DESC
    `;

    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).json({
      ok: true,
      products
    });
  } catch (error) {
    console.error("PRODUCTS ERROR:", error);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
}
