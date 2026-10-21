import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getArticle(name) {
  const match = String(name || "").match(/(?:^|[^A-Z0-9])((?:HS-?\d{1,4}|\d{4,6}-\d+|TJ\d{4}|L\d{4}|ГТД-\d+))(?:\b|[.])/i);
  return match ? match[1].toUpperCase().replace(/^HS(?=\d)/, "HS-") : "";
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: "BOT_TOKEN sozlanmagan" });
    const image = String(req.body?.image || "").trim();
    const name = String(req.body?.name || "").trim();
    const article = getArticle(name);
    if (!image || !name || !article) return res.status(400).json({ ok: false, error: "Tovar nomi, artikuli va rasm kerak" });

    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ ok: false, error: "Rasm formati noto'g'ri" });
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) return res.status(400).json({ ok: false, error: "Rasm 4 MB dan kichik bo'lishi kerak" });

    await sql`CREATE TABLE IF NOT EXISTS azikom_channel_publications (
      article TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      message_id BIGINT,
      published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;
    const tracked = await sql`SELECT article FROM azikom_channel_publications WHERE article = ${article} LIMIT 1`;
    if (tracked.length) return res.status(409).json({ ok: false, error: "Bu artikul uchun rasm kanalga oldin yuborilgan" });

    const channelRows = await sql`SELECT name FROM products WHERE channel_id <> 'admin' AND is_deleted = FALSE`;
    const alreadyInChannel = channelRows.some(row => getArticle(row.name) === article);
    if (alreadyInChannel) return res.status(409).json({ ok: false, error: "Bu artikul AziKom kanalida oldindan bor" });

    const form = new FormData();
    form.append("chat_id", "@azikom_zakaz");
    form.append("photo", new Blob([buffer], { type: mimeType }), "product.jpg");
    form.append("caption", `${name}\nArtikul: ${article}`);

    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
    const result = await response.json();
    if (!result.ok) {
      console.error("AZIKOM CHANNEL PHOTO ERROR:", result);
      return res.status(502).json({ ok: false, error: result.description || "Telegram kanaliga rasm yuborilmadi" });
    }

    const photos = result.result?.photo || [];
    const largest = photos[photos.length - 1];
    if (!largest?.file_id) return res.status(502).json({ ok: false, error: "Telegram file_id qaytarmadi" });

    await sql`INSERT INTO azikom_channel_publications(article, product_id, channel_id, message_id) VALUES (${article}, 0, '@azikom_zakaz', ${result.result?.message_id || null}) ON CONFLICT (article) DO NOTHING`;
    return res.status(200).json({ ok: true, photo_file_id: largest.file_id, published: true, article });
  } catch (error) {
    console.error("ADMIN UPLOAD ERROR:", error);
    return res.status(500).json({ ok: false, error: "Rasm yuklashda xatolik" });
  }
}
