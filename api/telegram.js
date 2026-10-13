import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "AziKom Telegram backend ishlayapti" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const update = req.body;

    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        photo_file_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel_id, message_id)
      )
    `;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_edited BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`;

    await sql`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;

    if (update.message) {
      const message = update.message;
      const chat = message.chat;
      if (chat && (chat.type === "group" || chat.type === "supergroup")) {
        await sql`
          INSERT INTO bot_settings (key, value)
          VALUES ('order_group_chat_id', ${String(chat.id)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
        console.log("ORDER GROUP ID:", chat.id);
        return res.status(200).json({ ok: true, action: "group_saved", chat_id: chat.id });
      }

      if (chat?.type === "private") {
        const token = process.env.BOT_TOKEN;
        if (!token) {
          console.error("BOT_TOKEN is not configured");
          return res.status(500).json({ ok: false, error: "Bot token is not configured" });
        }
        await sql`CREATE TABLE IF NOT EXISTS user_profiles (
          telegram_id BIGINT PRIMARY KEY,
          phone TEXT NOT NULL DEFAULT '',
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL DEFAULT '',
          username TEXT NOT NULL DEFAULT '',
          avatar_data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        const sender = message.from;
        const adminIds = String(process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean);
        const isAdmin = !!sender?.id && adminIds.includes(String(sender.id));
        const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
        const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(String(message.text || ""));

        if (message.contact) {
          const contact = message.contact;
          if (!sender?.id || !contact.user_id || String(contact.user_id) !== String(sender.id)) {
            await fetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chat.id, text: "Iltimos, faqat o'zingizning telefon raqamingizni pastdagi tugma orqali yuboring.", reply_markup: { keyboard: [[{ text: "📱 Telefon raqamimni yuborish", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } })
            });
            return res.status(200).json({ ok: true, action: "foreign_contact_rejected" });
          }
          await sql`
            INSERT INTO user_profiles (telegram_id, phone, first_name, last_name, username)
            VALUES (${String(sender.id)}, ${String(contact.phone_number || "")}, ${String(sender.first_name || "")}, ${String(sender.last_name || "")}, ${String(sender.username || "")})
            ON CONFLICT (telegram_id) DO UPDATE SET
              phone = EXCLUDED.phone,
              first_name = CASE WHEN user_profiles.first_name = '' THEN EXCLUDED.first_name ELSE user_profiles.first_name END,
              last_name = CASE WHEN user_profiles.last_name = '' THEN EXCLUDED.last_name ELSE user_profiles.last_name END,
              username = EXCLUDED.username,
              updated_at = CURRENT_TIMESTAMP
          `;
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat.id,
              text: "Rahmat! ✅ Telefon raqamingiz saqlandi. Buyurtma berish va profilingizni tahrirlash uchun tugmani bosing.",
              reply_markup: {
                remove_keyboard: true,
                inline_keyboard: [[{ text: "🛒 Zakaz qilish", web_app: { url: "https://xitoytavar.vercel.app" } }]]
              }
            })
          });
          const result = await response.json();
          if (!result.ok) {
            console.error("TELEGRAM CONTACT REPLY ERROR:", result);
            return res.status(502).json({ ok: false, error: "Could not send order link" });
          }
          return res.status(200).json({ ok: true, action: "phone_saved_and_order_link_sent" });
        }

        if (isStart) {
          await sql`
            INSERT INTO user_profiles (telegram_id, first_name, last_name, username)
            VALUES (${String(sender.id)}, ${String(sender.first_name || "")}, ${String(sender.last_name || "")}, ${String(sender.username || "")})
            ON CONFLICT (telegram_id) DO UPDATE SET
              username = EXCLUDED.username,
              updated_at = CURRENT_TIMESTAMP
          `;
          const payload = isAdmin
            ? {
                chat_id: chat.id,
                text: "Assalomu alaykum, admin! 🛍 Buyurtma sahifasini ochish uchun tugmani bosing.",
                reply_markup: { inline_keyboard: [[{ text: "🛒 Zakaz qilish", web_app: { url: "https://xitoytavar.vercel.app" } }]] }
              }
            : {
                chat_id: chat.id,
                text: "Assalomu alaykum! Buyurtma berishdan oldin telefon raqamingizni yuboring. Pastdagi tugmani bosing 👇",
                reply_markup: { keyboard: [[{ text: "📱 Telefon raqamimni yuborish", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
              };
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          if (!result.ok) {
            console.error("TELEGRAM START REPLY ERROR:", result);
            return res.status(502).json({ ok: false, error: "Could not send start reply" });
          }
          return res.status(200).json({ ok: true, action: isAdmin ? "admin_start_link_sent" : "phone_requested" });
        }
      }
    }

    const post = update.channel_post || update.edited_channel_post;
    if (!post) return res.status(200).json({ ok: true, ignored: true });

    if (!post.photo || post.photo.length === 0) {
      return res.status(200).json({ ok: true, ignored: true, reason: "Rasm yo'q" });
    }

    const channelId = String(post.chat.id);
    const messageId = post.message_id;
    const photoFileId = post.photo[post.photo.length - 1].file_id;
    const name = (post.caption || "Nomsiz mahsulot").trim();

    const existing = await sql`
      SELECT id, admin_edited
      FROM products
      WHERE channel_id = ${channelId} AND message_id = ${messageId}
      LIMIT 1
    `;

    if (!existing.length) {
      await sql`
        INSERT INTO products (channel_id, message_id, name, photo_file_id, updated_at)
        VALUES (${channelId}, ${messageId}, ${name}, ${photoFileId}, CURRENT_TIMESTAMP)
      `;
    } else if (!existing[0].admin_edited) {
      await sql`
        UPDATE products
        SET name = ${name}, photo_file_id = ${photoFileId}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existing[0].id}
      `;
    }

    console.log("PRODUCT SAVED:", name);
    return res.status(200).json({
      ok: true,
      action: update.edited_channel_post ? "updated" : "created",
      product: { channelId, messageId, name, hasPhoto: true }
    });
  } catch (error) {
    console.error("TELEGRAM WEBHOOK ERROR:", error);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
