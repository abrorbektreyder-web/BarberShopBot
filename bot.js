const { Bot, InlineKeyboard, session } = require("grammy");
const postgres = require("postgres");
const cron = require("node-cron");
const http = require("http");

// --- ⚙️ SOZLAMALAR ---

// ✅ TAYYOR TOKEN VA LINK:
const BOT_TOKEN = "7863103574:AAEGC6y5ZuA4orbugd8Ssqiyv-sl4vSfvfs"; 
const DATABASE_URL = "postgresql://postgres.nqvzqndmtxqrvjtigzuw:BarberShopbot7777@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";

// ⚠️ 6377333240:
const ADMIN_ID = 99999999; 

// Andijon markazi
const LOCATION = { lat: 40.7821, lon: 72.3442 }; 

const bot = new Bot(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: "require" });

// Xotira
bot.use(session({ initial: () => ({ step: "main" }) }));

// Render uchun "yurak urishi"
http.createServer((req, res) => { 
    res.write("BarberBot ishlayapti!"); 
    res.end(); 
}).listen(process.env.PORT || 3000);

// --- 📅 YORDAMCHI: Haftalik Kalendar ---
function getWeekKeyboard() {
    const keyboard = new InlineKeyboard();
    const days = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Juma", "Shan"];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + i);
        const dateStr = nextDate.toISOString().split('T')[0];
        const btnText = `${nextDate.getDate()}.${nextDate.getMonth() + 1} (${days[nextDate.getDay()]})`;
        keyboard.text(btnText, `date_${dateStr}`);
        if ((i + 1) % 2 === 0) keyboard.row(); 
    }
    keyboard.row().text("🔙 Bosh menyu", "goto_main");
    return keyboard;
}

// --- 🕒 YORDAMCHI: Vaqtlarni hisoblash ---
async function getTimeSlots(masterId, dateStr, duration) {
    const master = await sql`SELECT start_time, end_time FROM masters WHERE id = ${masterId}`;
    const bookings = await sql`SELECT start_time FROM appointments WHERE master_id = ${masterId} AND booking_date = ${dateStr} AND status != 'cancelled'`;

    let slots = [];
    let startH = master[0].start_time; 
    let endH = master[0].end_time;     
    
    let currentMin = startH * 60;
    let endMin = endH * 60;

    while (currentMin + duration <= endMin) {
        let h = Math.floor(currentMin / 60);
        let m = currentMin % 60;
        let timeStr = `${h}:${m < 10 ? '0'+m : m}`; 
        let timeStrSQL = `${h < 10 ? '0'+h : h}:${m < 10 ? '0'+m : m}:00`; 

        const isTaken = bookings.some(b => b.start_time === timeStrSQL);
        if (!isTaken) slots.push(timeStr);
        
        currentMin += duration; 
    }
    return slots;
}

// --- 🖥 MENYULAR LOGIKASI ---
async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    // 1. MASTER PANELI (Agar foydalanuvchi Master bo'lsa)
    const master = await sql`SELECT * FROM masters WHERE telegram_id = ${userId}`;
    
    if (master.length > 0 && step === "main") {
        text = `🛠 **Master Paneli**\n\nSalom, ${master[0].full_name}!\nBugungi ishlar ro'yxati:`;
        keyboard.text("📋 Bugungi mijozlarim", "master_today").row();
        return { text, keyboard };
    }

    // 2. ADMIN PANELI (Agar foydalanuvchi Biznes egasi bo'lsa)
    if (userId === ADMIN_ID && step === "main") {
        text = "👑 **Admin Paneli**\n\nXo'jayin, bugun qancha pul topdik?";
        keyboard.text("📊 Kunlik Hisobot", "admin_report").row();
        keyboard.text("✂️ Oddiy mijoz rejimi", "client_mode"); // Mijoz sifatida ko'rish uchun
        return { text, keyboard };
    }

    // 3. ODDJY MIJOZ MENYUSI
    if (step === "main" || step === "client_mode") {
        text = "💈 **Elegance Barbershop** ga xush kelibsiz!\n\nBizning manzil: Andijon shahar.";
        keyboard.text("✂️ Navbat olish", "goto_services").row();
        keyboard.text("📍 Bizning manzil", "send_location").row();
        keyboard.text("👤 Mening bronlarim", "my_bookings");
    }
    else if (step === "services") {
        text = "Kerakli xizmatni tanlang:";
        const services = await sql`SELECT * FROM services`;
        services.forEach(s => {
            keyboard.text(`${s.name} - ${s.price} (${s.duration} min)`, `srv_${s.id}_${s.duration}`).row();
        });
        keyboard.text("🔙 Orqaga", "goto_main");
    }
    else if (step === "masters") {
        text = "Ma'qul kelgan ustani tanlang:";
        const masters = await sql`SELECT * FROM masters`;
        masters.forEach(m => {
            keyboard.text(`💇‍♂️ ${m.full_name}`, `mst_${m.id}`).row();
        });
        keyboard.text("🔙 Orqaga", "goto_services");
    }
    else if (step === "date") {
        text = "Qaysi kunga yozilmoqchisiz?";
        keyboard = getWeekKeyboard();
    }
    else if (step === "time") {
        text = `📅 ${ctx.session.date}\n✂️ Davomiylik: ${ctx.session.duration} daqiqa\n\nBo'sh vaqtni tanlang:`;
        const slots = await getTimeSlots(ctx.session.masterId, ctx.session.date, ctx.session.duration);
        
        if (slots.length === 0) text += "\n\n(Bu kunga joy qolmagan)";

        let rowCount = 0;
        slots.forEach(t => {
            keyboard.text(t, `time_${t}`);
            rowCount++;
            if (rowCount % 4 === 0) keyboard.row();
        });
        keyboard.row().text("🔙 Orqaga", "goto_date");
    }
    return { text, keyboard };
}

// --- 🤖 BOT START ---
bot.command("start", async (ctx) => {
    ctx.session = { step: "main" };
    // Mijozni bazaga qo'shish
    try {
        await sql`INSERT INTO clients (telegram_id, full_name, username) 
                  VALUES (${ctx.from.id}, ${ctx.from.first_name}, ${ctx.from.username}) 
                  ON CONFLICT (telegram_id) DO NOTHING`;
    } catch (e) {}

    const menu = await getMenu(ctx.from.id, "main", ctx);
    await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
});

// --- 🧭 NAVIGATSIYA ---
bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

    // --- ADMIN UCHUN ---
    if (data === "admin_report") {
        const today = new Date().toISOString().split('T')[0];
        // Faqat tugatilgan (pul to'langan) ishlarni hisoblaymiz
        const stats = await sql`
            SELECT m.full_name, COUNT(*) as count, SUM(s.price) as total
            FROM appointments a
            JOIN masters m ON a.master_id = m.id
            JOIN services s ON a.service_id = s.id
            WHERE a.booking_date = ${today} AND a.status = 'completed'
            GROUP BY m.full_name
        `;
        
        let msg = `📊 **${today} uchun hisobot:**\n\n`;
        let totalSum = 0;
        
        if (stats.length === 0) msg += "Bugun hali tushum bo'lmadi.";
        else {
            stats.forEach(s => {
                msg += `👤 ${s.full_name}: ${s.count} ta mijoz | ${s.total} so'm\n`;
                totalSum += parseInt(s.total);
            });
            msg += `\n💰 **Jami tushum:** ${totalSum} so'm`;
        }
        await ctx.reply(msg, { parse_mode: "Markdown" });
        return;
    }
    
    if (data === "client_mode") {
        ctx.session.step = "main"; // Adminni oddiy menyuga o'tkazish
    }

    // --- MASTER UCHUN ---
    if (data === "master_today") {
        const today = new Date().toISOString().split('T')[0];
        // Masterni ID sini topamiz
        const master = await sql`SELECT id FROM masters WHERE telegram_id = ${userId}`;
        
        // Bugungi hali tugatilmagan ishlarni olamiz
        const jobs = await sql`
            SELECT a.id, a.start_time, c.full_name, s.name 
            FROM appointments a
            JOIN clients c ON a.client_id = c.id
            JOIN services s ON a.service_id = s.id
            WHERE a.master_id = ${master[0].id} AND a.booking_date = ${today} AND a.status = 'booked'
            ORDER BY a.start_time
        `;
        
        if (jobs.length === 0) {
            await ctx.reply("Hozircha navbatda turgan mijozlar yo'q. Dam oling! 😎");
        } else {
            for (const job of jobs) {
                // Har bir mijoz uchun alohida karta chiqaramiz
                await ctx.reply(`🕒 **${job.start_time}**\n👤 Mijoz: ${job.full_name}\n✂️ Xizmat: ${job.name}`, {
                    reply_markup: new InlineKeyboard().text("✅ Ishni tugatdim (Pul oldim)", `done_${job.id}`)
                });
            }
        }
        return;
    }

    // --- MASTER ISHNI TUGATDI ---
    if (data.startsWith("done_")) {
        const appId = data.split("_")[1];
        
        // 1. Bazada 'completed' qilish
        await sql`UPDATE appointments SET status = 'completed' WHERE id = ${appId}`;
        await ctx.editMessageText("✅ Hisobga yozildi! Keyingisiga o'tamiz.");
        
        // 2. Mijozga baho so'rash
        const app = await sql`SELECT client_id, master_id FROM appointments WHERE id = ${appId}`;
        const client = await sql`SELECT telegram_id FROM clients WHERE id = ${app[0].client_id}`;
        const master = await sql`SELECT full_name FROM masters WHERE id = ${app[0].master_id}`;
        
        try {
            await bot.api.sendMessage(client[0].telegram_id, `💇‍♂️ **Xizmatimiz yoqdimi?**\nMaster ${master[0].full_name} ishiga baho bering:`, {
                reply_markup: new InlineKeyboard()
                    .text("⭐️ 5 (Zo'r)", `rate_${appId}_5`).text("⭐️ 4 (Yaxshi)", `rate_${appId}_4`).row()
                    .text("⭐️ 3 (O'rtacha)", `rate_${appId}_3`).text("👎 Yomon", `rate_${appId}_1`)
            });
        } catch (e) { console.log("Mijoz botni bloklagan bo'lishi mumkin"); }
        
        // 3. Adminga xabar
        try {
            await bot.api.sendMessage(ADMIN_ID, `💰 **Tushum!**\nMaster ${master[0].full_name} bitta ishni yopdi.`);
        } catch (e) {}
        
        return;
    }

    // --- MIJOZ BAHOSI ---
    if (data.startsWith("rate_")) {
        const [_, appId, score] = data.split("_");
        await ctx.editMessageText("Rahmat! Bahoyingiz qabul qilindi. Biz uchun bu muhim! 😊");
        
        // Adminga bildirish
        try {
            await bot.api.sendMessage(ADMIN_ID, `⭐️ Mijoz baho qo'ydi: ${score} ball.`);
        } catch (e) {}
        return;
    }

    // --- NAVIGATSIYA (ODDIY) ---
    if (data === "send_location") {
        await ctx.replyWithLocation(LOCATION.lat, LOCATION.lon);
        return;
    }
    if (data === "goto_main") ctx.session.step = "main";
    else if (data === "goto_services") ctx.session.step = "services";
    else if (data === "goto_date") ctx.session.step = "date";

    else if (data.startsWith("srv_")) {
        const [_, id, duration] = data.split("_");
        ctx.session.serviceId = id;
        ctx.session.duration = parseInt(duration);
        ctx.session.step = "masters";
    }
    else if (data.startsWith("mst_")) {
        ctx.session.masterId = data.split("_")[1];
        ctx.session.step = "date";
    }
    else if (data.startsWith("date_")) {
        ctx.session.date = data.split("_")[1];
        ctx.session.step = "time";
    }
    else if (data.startsWith("time_")) {
        const time = data.split("_")[1];
        try {
            const client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
            let [h, m] = time.split(":").map(Number);
            let totalMin = h * 60 + m + ctx.session.duration;
            let endH = Math.floor(totalMin / 60);
            let endM = totalMin % 60;
            let endTimeStr = `${endH}:${endM < 10 ? '0'+endM : endM}:00`;
            let startTimeStr = `${time}:00`;

            await sql`
                INSERT INTO appointments (booking_date, start_time, end_time, master_id, client_id, service_id)
                VALUES (${ctx.session.date}, ${startTimeStr}, ${endTimeStr}, ${ctx.session.masterId}, ${client[0].id}, ${ctx.session.serviceId})
            `;

            await ctx.deleteMessage();
            await ctx.reply(`✅ **Qabul qilindi!**\n\n📆 Sana: ${ctx.session.date}\n⏰ Vaqt: ${time}\n⏳ Davomiyligi: ${ctx.session.duration} min\n\n📍 Manzil: Andijon shahar.`);
            
            // Adminga xabar
            try { await bot.api.sendMessage(ADMIN_ID, `🆕 **Yangi Mijoz!**\nSana: ${ctx.session.date} | Vaqt: ${time}`); } catch(e){}
            
            ctx.session.step = "main";
            const menu = await getMenu(userId, "main", ctx);
            await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
            return;
        } catch (e) {
            console.log(e);
            await ctx.answerCallbackQuery({ text: "Bu vaqt band!", show_alert: true });
            return;
        }
    }

    const menu = await getMenu(userId, ctx.session.step, ctx);
    try { await ctx.editMessageText(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" }); } catch (e) {}
    await ctx.answerCallbackQuery();
});

bot.start();
console.log("✂️ Barbershop PRO ishga tushdi!");
