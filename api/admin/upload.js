import { requireAdmin } from "../../lib/adminAuth.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!requireAdmin(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: "BOT_TOKEN sozlanmagan" });

    const chatId = String(req.body?.chat_id || "").trim();
    const image = String(req.body?.image || "").trim();

    if (!chatId || !image) {
      return res.status(400).json({ ok: false, error: "Rasm va Telegram chat ID kerak" });
    }

    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) {
      return res.status(400).json({ ok: false, error: "Rasm formati noto'g'ri" });
    }

    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    if (!buffer.length || buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "Rasm 4 MB dan kichik bo'lishi kerak" });
    }

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", new Blob([buffer], { type: mimeType }), "product.jpg");

    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("ADMIN PHOTO UPLOAD ERROR:", result);
      return res.status(502).json({ ok: false, error: "Telegramga rasm yuborilmadi" });
    }

    const photos = result.result?.photo || [];
    const largest = photos[photos.length - 1];
    if (!largest?.file_id) {
      return res.status(502).json({ ok: false, error: "Telegram file_id qaytarmadi" });
    }

    return res.status(200).json({ ok: true, photo_file_id: largest.file_id });
  } catch (error) {
    console.error("ADMIN UPLOAD ERROR:", error);
    return res.status(500).json({ ok: false, error: "Rasm yuklashda xatolik" });
  }
}
