import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/adminAuth.js";
const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
function headers(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type,Authorization");res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");}
async function ensure(){
 await sql`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
 await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL`;
 const defaults=["Korzinalar","Oshxona buyumlari","Ilgak va osmalar","Unitaz vanna","Uy-ro‘zg‘or buyumlari","Tozalash vositalari","Aksessuarlar","Boshqa"];
 for(const name of defaults) await sql`INSERT INTO categories(name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
 const cats=await sql`SELECT id,name FROM categories WHERE name <> 'Boshqa'`;
 for(const c of cats){
  let pattern = c.name==="Korzinalar" ? "(korzina|корзин|basket)" : c.name==="Oshxona buyumlari" ? "(oshxona|кухн|кухон|нож|кухонн)" : c.name==="Ilgak va osmalar" ? "(вешал|плечик|hanger|vishel|veshal|ilgich|kiyim ilgich|ilgak|крюч|креплен|липуч)" : c.name==="Unitaz vanna" ? "(ершик|ёршик|ершики|ёршики|yorshik|yorsh|ershik|ерш|вантуз|avntuz|vantuz|унитаз|unitaz|ванна|vanna|туалет|toilet|wc|щетк.*(унитаз|туалет)|brush.*(toilet|wc))" : c.name==="Tozalash vositalari" ? "(tozal|щетк|губк|швабр)" : c.name==="Aksessuarlar" ? "(aksessuar|брелок|чехол)" : c.name==="Uy-ro‘zg‘or buyumlari" ? "(uy|дом|хранен)" : "";
  if(pattern) await sql`UPDATE products SET category_id=${c.id} WHERE category_id IS NULL AND name ~* ${pattern}`;
 }
 const bathroom=await sql`SELECT id FROM categories WHERE name = 'Unitaz vanna' LIMIT 1`;
 if(bathroom.length) await sql`UPDATE products SET category_id=${bathroom[0].id} WHERE name ~* '(ершик|ёршик|ершики|ёршики|yorshik|yorsh|ershik|ерш|вантуз|avntuz|vantuz|унитаз|unitaz|ванна|vanna|туалет|toilet|wc|щетк.*(унитаз|туалет)|brush.*(toilet|wc))'`;
 const hooks=await sql`SELECT id FROM categories WHERE name = 'Ilgak va osmalar' LIMIT 1`;
 if(hooks.length) await sql`UPDATE products SET category_id=${hooks[0].id} WHERE name ~* '(вешал|плечик|hanger|vishel|veshal|ilgich|kiyim ilgich|ilgak|крюч|креплен|липуч)'`;
 const other=await sql`SELECT id FROM categories WHERE name = 'Boshqa' LIMIT 1`;
 if(other.length) await sql`UPDATE products SET category_id=${other[0].id} WHERE category_id IS NULL`;

 // Automatically create categories for repeated product types still in "Boshqa".
 if(other.length){
  const unclassified=await sql`SELECT id,name FROM products WHERE category_id=${other[0].id} AND is_deleted=FALSE ORDER BY id`;
  const stop=new Set(["va","uchun","bilan","dan","ga","ni","the","and","with","for","set","набор","для","и","с","в","на","из","по","шт","шт.","новый","новая","новое","размер","цвет","модель","товар","hs"]);
  const groups=new Map();
  for(const p of unclassified){
   const title=String(p.name||"").replace(/^\s*(?:HS[-_ ]?)?\\d+[A-ZА-ЯЁ]?\s*[-–—:]?\s*/i,"").replace(/\s+/g," ").trim();
   const words=(title.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]+/g)||[]).filter(w=>!stop.has(w.toLowerCase()));
   if(!words.length) continue;
   const key=words.slice(0,Math.min(2,words.length)).map(w=>w.toLowerCase()).join(" ");
   if(!key || key.length<3) continue;
   if(!groups.has(key)) groups.set(key,{name:words.slice(0,Math.min(2,words.length)).join(" "),ids:[]});
   groups.get(key).ids.push(p.id);
  }
  for(const group of groups.values()){
   if(group.ids.length<4) continue;
   const existing=await sql`SELECT id FROM categories WHERE lower(name)=lower(${group.name}) LIMIT 1`;
   let categoryId=existing.length?existing[0].id:null;
   if(categoryId===null){
    const created=await sql`INSERT INTO categories(name) VALUES (${group.name}) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`;
    if(created.length) categoryId=created[0].id;
   }
   if(categoryId!==null){
    for(const productId of group.ids) await sql`UPDATE products SET category_id=${categoryId} WHERE id=${productId} AND category_id=${other[0].id}`;
   }
  }
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