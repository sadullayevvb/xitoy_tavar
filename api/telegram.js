import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const BOT_TOKEN = process.env.BOT_TOKEN;

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "AziKom Telegram backend ishlayapti"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const update = req.body;

    // Database jadvalini avtomatik yaratish
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id BIGINT NOT NULL,
        name TEXT NOT NULL,
        photo_file_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel_id, message_id)
      )
    `;

    // Faqat kanal postlarini qabul qilamiz
    if (!update.channel_post) {
      return res.status(200).json({
        ok: true,
        ignored: true
      });
    }

    const post = update.channel_post;

    const channelId = String(post.chat.id);
    const messageId = post.message_id;

    // Mahsulot nomi — postdagi matn/caption
    const name = (
      post.caption ||
      post.text ||
      "Nomsiz mahsulot"
    ).trim();

    // Rasmning eng katta variantini olamiz
    let photoFileId = null;

    if (post.photo && post.photo.length > 0) {
      photoFileId = post.photo[post.photo.length - 1].file_id;
    }

    // Mahsulotni bazaga saqlash
    await sql`
      INSERT INTO products
        (channel_id, message_id, name, photo_file_id)
      VALUES
        (${channelId}, ${messageId}, ${name}, ${photoFileId})
      ON CONFLICT (channel_id, message_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        photo_file_id = EXCLUDED.photo_file_id
    `;

    return res.status(200).json({
      ok: true,
      product: {
        name,
        hasPhoto: Boolean(photoFileId)
      }
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "Server error"
    });
  }
}
