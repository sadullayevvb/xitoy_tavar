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
