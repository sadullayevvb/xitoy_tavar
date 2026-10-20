import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sql = neon(DATABASE_URL);

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!OPENAI_API_KEY) return fail(res, 503, "Rasm orqali qidirish uchun Vercel’da OPENAI_API_KEY sozlamasi kerak.");

  try {
    const image = req.body?.image;
    if (typeof image !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
      return fail(res, 400, "JPG, PNG yoki WEBP rasm tanlang.");
    }
    if (image.length > 5_500_000) return fail(res, 413, "Rasm juda katta. Kichikroq rasm tanlang.");

    const products = await sql`
      SELECT p.id, p.name, p.stock_qty, p.category_id, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.is_deleted = FALSE
      ORDER BY p.id DESC
      LIMIT 500
    `;
    if (!products.length) return res.status(200).json({ ok: true, ids: [], message: "Katalog bo‘sh." });

    const catalog = products.map(p => ({
      id: Number(p.id),
      name: String(p.name || ""),
      category: String(p.category_name || ""),
      in_stock: Number(p.stock_qty || 0) > 0
    }));
    const prompt = [
      "You are a visual shopping assistant for an Uzbek home-goods catalog.",
      "Look at the user's uploaded product photo and find the closest matching products from the catalog list.",
      "Product names may contain HS codes and Russian, Uzbek, or Chinese-derived words. Match the object type and visible design, not just exact spelling.",
      "Return ONLY valid JSON in this exact shape: {\"ids\":[number,number],\"message\":\"short Uzbek explanation\"}.",
      "Include at most 12 best matches, in descending similarity order. Do not invent IDs. If nothing matches, return {\"ids\":[],\"message\":\"Mos tovar topilmadi\"}.",
      "Prefer available products (in_stock true), but include a close match even if out of stock.",
      "Catalog JSON:",
      JSON.stringify(catalog)
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image, detail: "low" }
          ]
        }],
        max_output_tokens: 500
      })
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("VISUAL SEARCH AI ERROR:", result?.error?.message || response.status);
      return fail(res, 502, "AI qidiruv vaqtincha ishlamadi. Keyinroq qayta urinib ko‘ring.");
    }
    const text = result.output_text || (result.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("\n");
    let parsed;
    try {
      const clean = String(text).replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("VISUAL SEARCH INVALID AI RESPONSE:", text);
      return fail(res, 502, "AI javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring.");
    }
    const validIds = new Set(products.map(p => Number(p.id)));
    const ids = [...new Set((Array.isArray(parsed.ids) ? parsed.ids : []).map(Number).filter(id => validIds.has(id)))].slice(0, 12);
    return res.status(200).json({
      ok: true,
      ids,
      message: String(parsed.message || (ids.length ? "Rasmga o‘xshash tovarlar" : "Mos tovar topilmadi")).slice(0, 180)
    });
  } catch (error) {
    console.error("VISUAL SEARCH ERROR:", error);
    return fail(res, 500, "Rasm bo‘yicha qidirishda xatolik yuz berdi.");
  }
}
