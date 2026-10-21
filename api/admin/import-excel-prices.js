import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);
const PRICES = Object.fromEntries(Object.entries({"HS-18":1.61,"HS-19":1.44,"HS-20":1.36,"HS-15":2.49,"HS-16":2.41,"HS-21":3.45,"HS-107":0.4,"HS-108":0.5,"HS-109":0.59,"HS-64":1.72,"HS-65":1.05,"HS-66":1.34,"HS-67":0.97,"HS-68":0.82,"HS-75":0,"HS-76":5.9,"HS-77":5.8,"HS-1":2.61,"HS-3":0,"HS-4":0,"HS-5":0,"HS-6":1.85,"HS-8":0,"HS-9":2.06,"HS-10":1.09,"13964-1":0,"13964-3":0,"13964-2":9.36,"13964-5":0,"HS-151":0.46,"HS-152":0.7,"HS-155":0.7,"HS-156":1.19,"HS-160":1.34,"HS-162":1,"HS-157":1.73,"HS-158":1.87,"HS-159":1.37,"HS-164":1.67,"HS-154":1.29,"HS-161":1.06,"HS-165":1.2,"HS-166":1.9,"HS-168":1.25,"HS-171":1.67,"HS-172":1.39,"HS-175":1.34,"HS-170":1.15,"HS-163":1.31,"HS-169":1.9,"HS-180":15.36,"HS-181":0,"HS-40":0.37,"HS-37":0.42,"HS-290":0,"HS-213":1.84,"HS-214":0,"HS-215":2.41,"HS-216":2.83,"HS-100":1.47,"HS-101":1.09,"HS-206":0.57,"HS-46":1.68,"HS-47":0,"HS-48":0,"HS-49":0,"HS-196":1.54,"HS-197":1.33,"HS-266":6.38,"HS-271":0,"HS-272":1.92,"HS-273":2.01,"HS-250":7.27,"HS-267":0,"HS-268":0,"HS-269":0,"HS-270":0,"HS-274":3.55,"HS-251":3.09,"HS-253":2.94,"HS-254":4.18,"HS-262":3.78,"HS-255":2.94,"HS-257":5.46,"HS-260":2.97,"HS-261":4.27,"HS-264":1.88,"HS-265":0,"HS-263":2.55,"HS-258":5.36,"HS-259":4.18,"HS-256":4.18,"HS-252":3.13,"HS-190":3.82,"HS-191":0,"HS-104":1.09,"HS-105":1.77,"HS-106":0,"HS-95":1.64,"HS-96":1.26,"HS-97":1.01,"HS-98":0.71,"HS-99":1.85,"HS-102":0.71,"HS-103":1.45,"HS-217":3.03,"HS-218":3.49,"HS-219":4.01,"HS-204":0.36,"HS-205":0.36,"HS-203":0.17,"HS-30":2.09,"HS-31":2,"HS-32":1.77,"HS-200":0.29,"HS-201":0.41,"13964-4":0,"HS-135":0,"HS-137":0,"HS-136":0,"HS-131":0,"HS-134":0,"HS-133":0,"HS-132":0,"HS-11":0,"HS-12":0,"HS-13":0,"HS-79":1.54,"HS-80":1.07,"HS-81":1.18,"HS-82":1.18,"HS-83":1.43,"HS-84":1.2,"HS-85":1.18,"HS-86":1.18,"HS-87":1.14,"HS-88":1.14,"HS-89":1.14,"HS-90":1.16,"HS-91":1.16,"HS-92":1.24,"HS-93":1.22,"HS-94":1.16,"HS-42":0.77,"HS-43":0.33,"HS-22":0.39,"HS-24":0.46,"HS-25":0.39,"HS-26":0.67,"HS-27":0.46,"HS-23":0.55,"HS-202":0.59,"HS-14":0.68,"HS-28":0.41,"HS-29":0.41,"HS-198":0.66,"HS-199":1.16,"HS-193":1.43,"HS-194":1.49,"HS-195":1.58,"HS-207":1.87,"HS-208":1.33,"HS-78":1.66,"HS-56":2.15,"HS-74":2.19,"HS-275":39.19,"L0103":34.56,"L0104":0,"TJ0102":12.77,"TJ0103":16.59,"TJ0104":19.46,"TJ0105":22.52,"10873-1":4.51,"10873-2":9.57,"10873-3":6.8,"10873-4":5.66,"10873-5":10.05,"10873-6":0,"10873-7":11.39,"10873-8":4.89,"HS-183":3.24,"HS-184":3.38,"HS-188":3.45,"HS-189":2.12,"HS-212":0,"HS-185":0,"HS-186":0,"HS-187":4.52,"HS-211":0,"HS-45":1.01,"HS-59":2.8,"HS-60":2.92,"HS-63":0,"HS-209":1.51,"HS-210":3.89,"HS-50":0,"HS-51":0,"HS-54":1.23,"HS-55":2.04,"HS-57":1.8,"HS-58":2.15,"HS-61":1.98,"HS-62":0,"HS-52":2.02,"HS-53":1.54,"HS-69":0.86,"HS-70":1.47,"HS-72":1.47,"HS-73":1.47}).map(([code, price]) => [code.toUpperCase(), price]));

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  try {
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0`;
    const products = await sql`SELECT id, name FROM products WHERE is_deleted = FALSE`;
    const updated = [];
    const missing = [];
    const matchedCodes = new Set();
    for (const product of products) {
      const match = String(product.name || "").toUpperCase().match(/(^|[^A-Z0-9])((?:HS-\d+)|(?:13964-\d+)|(?:10873-\d+)|(?:L\d{4})|(?:TJ\d{4}))(?=$|[^A-Z0-9])/);
      if (!match) continue;
      const code = match[2];
      if (!Object.prototype.hasOwnProperty.call(PRICES, code)) continue;
      await sql`UPDATE products SET price = ${PRICES[code]}, updated_at = CURRENT_TIMESTAMP WHERE id = ${product.id}`;
      updated.push({ id: product.id, name: product.name, code, price: PRICES[code] });
      matchedCodes.add(code);
    }
    for (const code of Object.keys(PRICES)) if (!matchedCodes.has(code)) missing.push(code);
    return res.status(200).json({ ok: true, updated_count: updated.length, missing_codes: missing, updated });
  } catch (error) {
    console.error("EXCEL PRICE IMPORT ERROR:", error);
    return res.status(500).json({ ok: false, error: "Narxlarni Excel bilan moslashda xatolik" });
  }
}
