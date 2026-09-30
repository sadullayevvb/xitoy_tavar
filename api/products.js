import { neon } from "@neondatabase/serverless";

const DATABASE_URL =
  process.env.DATABASE_URL || process.env.POSTGRES_URL;

const sql = neon(DATABASE_URL);

export default async function handler(req, res) {

  // CORS
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Faqat GET
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {

    const products = await sql`
      SELECT
        id,
        channel_id,
        message_id,
        name,
        photo_file_id,
        created_at
      FROM products
      ORDER BY id DESC
    `;

    return res.status(200).json({
      ok: true,
      products
    });

  } catch (error) {

    console.error(
      "PRODUCTS ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Database error"
    });

  }
}
