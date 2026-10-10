import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";
const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
function headers(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization");res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");}
async function ensure(){
 await sql`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
 await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL`;
 const defaults=["Korzinalar","Oshxona buyumlari","Ilgak va osmalar","Uy-ro‘zg‘or buyumlari","Tozalash vositalari","Aksessuarlar","Boshqa"];
 for(const name of defaults) await sql`INSERT INTO categories(name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
 const cats=await sql`SELECT id,name FROM categories`;
 for(const c of cats){
  let pattern = c.name==="Korzinalar" ? "(korzina|корзин|basket)" : c.name==="Oshxona buyumlari" ? "(oshxona|кухн|кухон|нож|кухонн)" : c.name==="Ilgak va osmalar" ? "(ilgak|крюч|креплен|липуч)" : c.name==="Tozalash vositalari" ? "(tozal|щетк|губк|швабр)" : c.name==="Aksessuarlar" ? "(aksessuar|брелок|чехол)" : c.name==="Uy-ro‘zg‘or buyumlari" ? "(uy|дом|хранен)" : "(?!)";
  await sql`UPDATE products SET category_id=${c.id} WHERE category_id IS NULL AND name ~* ${pattern}`;
 }
}
export default async function handler(req,res){
 headers(res);if(req.method==="OPTIONS")return res.status(204).end();if(!requireAdmin(req,res))return;
 try{await ensure();
 if(req.method==="GET"){const rows=await sql`SELECT c.id,c.name,COUNT(p.id)::int AS product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.is_deleted=FALSE GROUP BY c.id,c.name ORDER BY c.name`;return res.status(200).json({ok:true,categories:rows})}
 const id=Number(req.query?.id||req.body?.id||0);
 if(req.method==="POST"){const name=String(req.body?.name||"").trim();if(!name)return res.status(400).json({ok:false,error:"Kategoriya nomini kiriting"});const rows=await sql`INSERT INTO categories(name) VALUES (${name}) ON CONFLICT (name) DO NOTHING RETURNING id,name`;if(!rows.length)return res.status(409).json({ok:false,error:"Bu kategoriya bor"});return res.status(201).json({ok:true,category:rows[0]})}
 if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({ok:false,error:"Kategoriya ID noto‘g‘ri"});
 if(req.method==="PATCH"){const name=String(req.body?.name||"").trim();if(!name)return res.status(400).json({ok:false,error:"Kategoriya nomini kiriting"});const rows=await sql`UPDATE categories SET name=${name} WHERE id=${id} RETURNING id,name`;if(!rows.length)return res.status(404).json({ok:false,error:"Kategoriya topilmadi"});return res.status(200).json({ok:true,category:rows[0]})}
 if(req.method==="DELETE"){const rows=await sql`DELETE FROM categories WHERE id=${id} RETURNING id,name`;if(!rows.length)return res.status(404).json({ok:false,error:"Kategoriya topilmadi"});return res.status(200).json({ok:true,category:rows[0]})}
 return res.status(405).json({ok:false,error:"Method not allowed"});
 }catch(e){console.error("CATEGORIES ERROR",e);return res.status(500).json({ok:false,error:"Database error"})}
}