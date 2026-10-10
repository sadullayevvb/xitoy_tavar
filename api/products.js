import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

async function ensureCatalogColumns() {
  await sql`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL`;
  const defaults = ["Korzinalar", "Oshxona buyumlari", "Ilgak va osmalar", "Uy-ro‘zg‘or buyumlari", "Tozalash vositalari", "Aksessuarlar", "Boshqa"];
  for (const name of defaults) await sql`INSERT INTO categories(name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_edited BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`;
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0`;
  await sql`UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    await ensureCatalogColumns();
    const products = await sql`
      SELECT p.id, p.name, p.photo_file_id, p.stock_qty, p.category_id, c.name AS category_name, p.created_at, p.updated_at
      FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_deleted = FALSE ORDER BY p.id DESC
    `;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({ ok: true, products });
  } catch (error) {
    console.error("PRODUCTS ERROR:", error);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
}
