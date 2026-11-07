import { neon, Pool } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = neon(DATABASE_URL);

const BOT_TOKEN = process.env.BOT_TOKEN;
async function tg(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  return response.json();
}
function orderText(order, items, statusLine = "⏳ Holat: tasdiqlash kutilmoqda") {
  const lines = items.map((it, i) => `${i + 1}. ${it.product_name} — ${it.quantity} dona × ${Number(it.unit_price).toFixed(2)} = ${Number(it.line_total).toFixed(2)}`);
  return [`🛒 ZAKAZ #${order.id}`, "", `👤 Mijoz: ${order.customer_name}`, `🏪 Do‘kon: ${order.shop}`,
    `📍 Manzil: ${order.address}`, `📱 Telefon: ${order.phone}`, "", "📦 Mahsulotlar:", ...lines, "",
    `📊 Jami: ${items.reduce((n,x)=>n+Number(x.quantity),0)} dona`,
    `💵 Umumiy summa: ${items.reduce((n,x)=>n+Number(x.line_total),0).toFixed(2)}`, "", statusLine].join("\n");
}
async function handleOrderCallback(update) {
  const q = update.callback_query;
  const senderId = String(q.from?.id || "");
  const admins = String(process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (!admins.includes(senderId)) {
    await tg("answerCallbackQuery", { callback_query_id:q.id, text:"Bu tugma faqat admin uchun.", show_alert:true });
    return;
  }
  const data = String(q.data || "");
  const msg = q.message;
  const orderId = Number(data.split(":")[1]);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !msg) {
    await tg("answerCallbackQuery", { callback_query_id:q.id, text:"Buyurtma topilmadi.", show_alert:true }); return;
  }
  const orders = await sql`SELECT * FROM customer_orders WHERE id=${orderId} LIMIT 1`;
  if (!orders.length) { await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Buyurtma topilmadi.",show_alert:true}); return; }
  let order = orders[0];
  let items = await sql`SELECT * FROM customer_order_items WHERE order_id=${orderId} ORDER BY id`;
  if (data.startsWith("order_cancel:")) {
    if (order.status !== "pending") { await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Bu buyurtma allaqachon yakunlangan.",show_alert:true}); return; }
    await sql`UPDATE customer_orders SET status='cancelled' WHERE id=${orderId} AND status='pending'`;
    await tg("editMessageText",{chat_id:msg.chat.id,message_id:msg.message_id,text:orderText(order,items,"❌ Holat: bekor qilindi"),reply_markup:{inline_keyboard:[]}});
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Buyurtma bekor qilindi"});
    return;
  }
  if (data.startsWith("order_edit:")) {
    if (order.status !== "pending") { await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Faqat kutilayotgan buyurtma tahrirlanadi.",show_alert:true}); return; }
    const keyboard = items.map(it=>[
      {text:"−",callback_data:`oe:${orderId}:${it.id}:-1`},
      {text:`${it.product_name} · ${it.quantity} dona`,callback_data:"noop"},
      {text:"+",callback_data:`oe:${orderId}:${it.id}:1`}
    ]);
    keyboard.push([{text:"✅ Tahrir tugadi",callback_data:`oe_done:${orderId}`},{text:"❌ Bekor qilish",callback_data:`order_cancel:${orderId}`}]);
    await tg("editMessageText",{chat_id:msg.chat.id,message_id:msg.message_id,text:orderText(order,items,"✏️ Tahrirlash rejimi: miqdorni + / − bilan o‘zgartiring."),reply_markup:{inline_keyboard:keyboard}});
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Miqdorlarni o‘zgartiring"});
    return;
  }
  if (data.startsWith("oe:")) {
    if (order.status !== "pending") { await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Buyurtma yakunlangan.",show_alert:true}); return; }
    const [, , itemIdRaw, deltaRaw] = data.split(":");
    const itemId=Number(itemIdRaw), delta=Number(deltaRaw);
    const item=items.find(x=>Number(x.id)===itemId);
    if (!item || ![-1,1].includes(delta)) { await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Mahsulot topilmadi.",show_alert:true}); return; }
    const next=Number(item.quantity)+delta;
    if(next<1){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Miqdor kamida 1 bo‘lishi kerak."});return;}
    if(delta>0){
      const stock=await sql`SELECT stock_qty FROM products WHERE id=${item.product_id} LIMIT 1`;
      const other=await sql`SELECT COALESCE(SUM(oi.quantity),0)::int AS qty FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id WHERE oi.product_id=${item.product_id} AND o.status='pending' AND o.id<>${orderId}`;
      if(!stock.length||next+Number(other[0]?.qty||0)>Number(stock[0].stock_qty)){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Omborda buncha mahsulot yo‘q.",show_alert:true});return;}
    }
    await sql`UPDATE customer_order_items SET quantity=${next}, line_total=${next*Number(item.unit_price)} WHERE id=${itemId} AND order_id=${orderId}`;
    items=await sql`SELECT * FROM customer_order_items WHERE order_id=${orderId} ORDER BY id`;
    const keyboard=items.map(it=>[
      {text:"−",callback_data:`oe:${orderId}:${it.id}:-1`},
      {text:`${it.product_name} · ${it.quantity} dona`,callback_data:"noop"},
      {text:"+",callback_data:`oe:${orderId}:${it.id}:1`}
    ]);
    keyboard.push([{text:"✅ Tahrir tugadi",callback_data:`oe_done:${orderId}`},{text:"❌ Bekor qilish",callback_data:`order_cancel:${orderId}`}]);
    await tg("editMessageText",{chat_id:msg.chat.id,message_id:msg.message_id,text:orderText(order,items,"✏️ Tahrirlash rejimi: miqdorni + / − bilan o‘zgartiring."),reply_markup:{inline_keyboard:keyboard}});
    await tg("answerCallbackQuery",{callback_query_id:q.id});
    return;
  }
  if (data.startsWith("oe_done:")) {
    const keyboard=[[{text:"✅ Tasdiqlash",callback_data:`order_confirm:${orderId}`},{text:"❌ Bekor qilish",callback_data:`order_cancel:${orderId}`}]];
    await tg("editMessageText",{chat_id:msg.chat.id,message_id:msg.message_id,text:orderText(order,items,"📝 Tahrir saqlandi. Tasdiqlang yoki bekor qiling."),reply_markup:{inline_keyboard:keyboard}});
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Tahrir saqlandi"});
    return;
  }
  if (data.startsWith("order_confirm:")) {
    if(order.status!=="pending"){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Bu buyurtma allaqachon yakunlangan.",show_alert:true});return;}
    const settings=await sql`SELECT value FROM bot_settings WHERE key='order_group_chat_id' LIMIT 1`;
    if(!settings.length){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Buyurtma guruhi sozlanmagan.",show_alert:true});return;}
    const pool=new Pool({connectionString:DATABASE_URL,max:2});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const locked=await client.query("SELECT * FROM customer_orders WHERE id=$1 FOR UPDATE",[orderId]);
      if(!locked.rows.length||locked.rows[0].status!=="pending"){await client.query("ROLLBACK");await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Buyurtma allaqachon yakunlangan.",show_alert:true});return;}
      items=(await client.query("SELECT * FROM customer_order_items WHERE order_id=$1 ORDER BY id",[orderId])).rows;
      for(const it of items){
        const upd=await client.query("UPDATE products SET stock_qty=stock_qty-$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND stock_qty >= $1 RETURNING id",[it.quantity,it.product_id]);
        if(!upd.rows.length)throw new Error(`Qoldiq yetarli emas: ${it.product_name}`);
      }
      const groupText=orderText(order,items,"✅ Holat: admin tomonidan tasdiqlandi");
      const sent=await tg("sendMessage",{chat_id:settings[0].value,text:groupText});
      if(!sent.ok)throw new Error("Guruhga yuborilmadi: "+(sent.description||"Telegram xatosi"));
      await client.query("UPDATE customer_orders SET status='confirmed' WHERE id=$1",[orderId]);
      await client.query("COMMIT");
      await tg("editMessageText",{chat_id:msg.chat.id,message_id:msg.message_id,text:orderText(order,items,"✅ Holat: tasdiqlandi va guruhga yuborildi"),reply_markup:{inline_keyboard:[]}});
      await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Tasdiqlandi. Ombor qoldig‘i ayrildi."});
    }catch(err){try{await client.query("ROLLBACK")}catch(_){}await tg("answerCallbackQuery",{callback_query_id:q.id,text:err.message||"Tasdiqlashda xato",show_alert:true});}
    finally{client.release();await pool.end();}
    return;
  }
  if(data==="noop"){await tg("answerCallbackQuery",{callback_query_id:q.id});return;}
  await tg("answerCallbackQuery",{callback_query_id:q.id});
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "AziKom Telegram backend ishlayapti" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const update = req.body;
    if (update?.callback_query) {
      await handleOrderCallback(update);
      return res.status(200).json({ ok: true, action: "order_callback_handled" });
    }

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
