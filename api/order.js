import { neon } from "@neondatabase/serverless";

const sql = neon(
  process.env.DATABASE_URL || process.env.POSTGRES_URL
);

const BOT_TOKEN = process.env.BOT_TOKEN;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const { items, initData } = req.body || {};

    // Telegram Mini App foydalanuvchisini tekshirish
    if (!BOT_TOKEN || !initData) {
      return res.status(401).json({
        ok: false,
        error: "Telegram orqali kiring"
      });
    }

    const { createHmac, timingSafeEqual } =
      await import("node:crypto");

    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return res.status(401).json({ ok: false });
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secret = createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = createHmac("sha256", secret)
      .update(dataCheckString)
      .digest();

    if (!timingSafeEqual(
      calculatedHash,
      Buffer.from(receivedHash, "hex")
    )) {
      return res.status(401).json({
        ok: false,
        error: "Telegram tekshiruvidan o'tmadi"
      });
    }

    const authDate = Number(params.get("auth_date"));

    if (
      !Number.isFinite(authDate) ||
      Math.abs(Date.now() / 1000 - authDate) > 86400
    ) {
      return res.status(401).json({
        ok: false,
        error: "Mini Appni qayta oching"
      });
    }

    const user = JSON.parse(params.get("user") || "{}");

    if (!user.id) {
      return res.status(401).json({ ok: false });
    }

    // Mahsulotlar miqdorini tekshirish
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 100
    ) {
      return res.status(400).json({
        ok: false,
        error: "Savat bo'sh"
      });
    }

    const quantities = new Map();

    for (const item of items) {
      const id = Number(item.id);
      const quantity = Number(item.quantity);

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 999
      ) {
        return res.status(400).json({
          ok: false,
          error: "Noto'g'ri mahsulot yoki miqdor"
        });
      }

      quantities.set(
        id,
        (quantities.get(id) || 0) + quantity
      );
    }

    const ids = [...quantities.keys()];

    // Mahsulot nomlarini faqat bazadan olamiz
    const products = await sql`
      SELECT id, name
      FROM products
      WHERE id = ANY(${ids})
    `;

    if (products.length !== ids.length) {
      return res.status(400).json({
        ok: false,
        error: "Mahsulotlardan biri topilmadi"
      });
    }

    const settings = await sql`
      SELECT value
      FROM bot_settings
      WHERE key = 'order_group_chat_id'
      LIMIT 1
    `;

    if (!settings.length) {
      return res.status(500).json({
        ok: false,
        error: "Buyurtma guruhi sozlanmagan"
      });
    }

    const total = [...quantities.values()]
      .reduce((sum, qty) => sum + qty, 0);

    const lines = products.map((product, index) =>
      `${index + 1}. ${product.name} — ${
        quantities.get(product.id)
      } dona`
    );

    const message = [
      "🛒 YANGI ZAKAZ",
      "",
      `👤 Mijoz: ${
        user.first_name || "Noma'lum"
      } ${user.last_name || ""}`,
      `🔗 Username: ${
        user.username ? "@" + user.username : "Yo'q"
      }`,
      `🆔 Telegram ID: ${user.id}`,
      "",
      "📦 Mahsulotlar:",
      ...lines,
      "",
      `📊 Jami: ${total} dona`
    ].join("\n");

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: settings[0].value,
          text: message
        })
      }
    );

    const result = await telegramResponse.json();

    if (!result.ok) {
      console.error("SEND ORDER ERROR:", result);

      return res.status(502).json({
        ok: false,
        error: "Buyurtmani guruhga yuborib bo'lmadi"
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Buyurtma qabul qilindi"
    });

  } catch (error) {
    console.error("ORDER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Server error"
    });
  }
}
