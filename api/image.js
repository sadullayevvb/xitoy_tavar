const BOT_TOKEN = process.env.BOT_TOKEN;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const fileId = req.query.file_id;

    if (!fileId) {
      return res.status(400).json({
        ok: false,
        message: "file_id kerak"
      });
    }

    // Telegramdan file path olish
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
    );

    const fileData = await fileResponse.json();

    if (!fileData.ok || !fileData.result?.file_path) {
      return res.status(404).json({
        ok: false,
        message: "Telegram rasmi topilmadi"
      });
    }

    const filePath = fileData.result.file_path;

    // Telegramdan rasmni olish
    const imageResponse = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
    );

    if (!imageResponse.ok) {
      return res.status(404).json({
        ok: false,
        message: "Rasmni yuklab bo'lmadi"
      });
    }

    const contentType =
      imageResponse.headers.get("content-type") ||
      "image/jpeg";

    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.status(200).send(buffer);

  } catch (error) {
    console.error("IMAGE ERROR:", error);

    return res.status(500).json({
      ok: false,
      message: "Server error"
    });
  }
}
