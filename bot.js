const { Bot, InlineKeyboard, session } = require("grammy");
const postgres = require("postgres");
const cron = require("node-cron");
const http = require("http");

// --- ⚙️ SOZLAMALAR (Sizning ma'lumotlaringiz bilan to'ldirilgan) ---
const BOT_TOKEN = "7863103574:AAEGC6y5ZuA4orbugd8Ssqiyv-sl4vSfvfs"; 
const DATABASE_URL = "postgresql://postgres.nqvzqndmtxqrvjtigzuw:BarberShopbot7777@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";
const ADMIN_ID = 6377333240; // Sizning ID raqamingiz
const LOCATION = { lat: 40.7821, lon: 72.3442 }; 

const bot = new Bot(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: "require" });

// Xotira
bot.use(session({ initial: () => ({ step: "main" }) }));

// Render Heartbeat (Server o'chib qolmasligi uchun)
http.createServer((req, res) => { res.write("OK"); res.end(); }).listen(process.env.PORT || 3000);

// --- 🛠 YORDAMCHI FUNKSIYALAR ---

function getWeekKeyboard() {
    const keyboard = new InlineKeyboard();
    const days = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Juma", "Shan"];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + i);
        const btnText = `${nextDate.getDate()}.${nextDate.getMonth() + 1} (${days[nextDate.getDay()]})`;
        keyboard.text(btnText, `date_${nextDate.toISOString().split('T')[0]}`);
        if ((i + 1) % 2 === 0) keyboard.row(); 
    }
    keyboard.row().text("🔙 Bosh menyu", "goto_main");
    return keyboard;
}

async function getTimeSlots(masterId, dateStr, duration) {
    try {
        const master = await sql`SELECT start_time, end_time FROM masters WHERE id = ${masterId}`;
        const bookings = await sql`SELECT start_time FROM appointments WHERE master_id = ${masterId} AND booking_date = ${dateStr} AND status != 'cancelled'`;
        let slots = [];
        let startH = parseInt(master[0].start_time); 
        let endH = parseInt(master[0].end_time);     
        let currentMin = startH * 60;
        let endMin = endH * 60;
        while (currentMin + duration <= endMin) {
            let h = Math.floor(currentMin / 60);
            let m = currentMin % 60;
            let timeStr = `${h}:${m < 10 ? '0'+m : m}`; 
            let timeSQL = `${h < 10 ? '0'+h : h}:${m < 10 ? '0'+m : m}:00`; 
            const isTaken = bookings.some(b => b.start_time === timeSQL);
            slots.push({ time: timeStr, status: isTaken ? 'taken' : 'free' });
            currentMin += duration; 
        }
        return slots;
    } catch (e) {
        console.error("getTimeSlots xatosi:", e);
        return [];
    }
}

// --- 🖥 MENYULAR ---

async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    // 👑 ADMIN PANELI (Faqat "main" qadamida ko'rinadi)
    if (userId === ADMIN_ID && step === "main") {
        text = "👑 **Admin Paneli**";
        keyboard.text("📊 Hisobot", "admin_report").row();
        keyboard.text("✂️ Mijoz rejimi", "client_mode");
        return { text, keyboard };
    }

    // 👤 MIJOZ PANELI
    if (step === "main" || step === "client_mode") {
        text = "💈 **Elegance Barbershop**\nZamonaviy soch turmaklari va sifatli xizmat!";
        keyboard.text("✂️ Navbat olish", "goto_services").row();
        keyboard.text("📍 Bizning manzil", "send_location").row();
        keyboard.text("👤 Mening bronlarim", "my_bookings");
        if (userId === ADMIN_ID) { // Adminga ortga qaytish tugmasi
            keyboard.row().text("👑 Admin paneliga", "goto_main");
        }
    }
    else if (step === "services") {
        text = "Xizmatni tanlang:";
        const services = await sql`SELECT * FROM services`;
        services.forEach(s => keyboard.text(`${s.name} (${s.price})`, `srv_${s.id}_${s.duration}`).row());
        keyboard.text("🔙 Orqaga", "client_mode");
    }
    else if (step === "masters") {
        text = "Usta tanlang:";
        const masters = await sql`SELECT * FROM masters`;
        masters.forEach(m => keyboard.text(m.full_name, `mst_${m.id}`).row());
        keyboard.text("🔙 Orqaga", "goto_services");
    }
    else if (step === "date") {
        text = "Kunni tanlang:";
        keyboard = getWeekKeyboard();
        keyboard.text("🔙 Orqaga", "goto_masters");
    }
    else if (step === "time") {
        text = "Vaqtni tanlang:\n(🔴 - Band, 🟢 - Bo'sh)";
        const slots = await getTimeSlots(ctx.session.masterId, ctx.session.date, ctx.session.duration);
        let r = 0;
        if (slots.length > 0) {
            slots.forEach(s => { 
                if (s.status === 'free') keyboard.text(`🟢 ${s.time}`, `time_${s.time}`);
                else keyboard.text(`🔴 ${s.time}`, `ignore_taken`);
                r++; 
                if (r % 4 === 0) keyboard.row(); 
            });
        } else {
            text = "Uzur, bu kunga bo'sh vaqtlar topilmadi.";
        }
        keyboard.row().text("🔙 Orqaga", "goto_date");
    }
    return { text, keyboard };
}

// --- 🤖 START ---

bot.command("start", async (ctx) => {
    ctx.session = { step: "main" };
    try {
        await sql`INSERT INTO clients (telegram_id, full_name, username) 
                  VALUES (${ctx.from.id}, ${ctx.from.first_name}, ${ctx.from.username || null}) 
                  ON CONFLICT (telegram_id) DO NOTHING`; 
    } catch (e) { console.error("Start Error:", e); }
    const menu = await getMenu(ctx.from.id, "main", ctx);
    await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
});

// --- 🧭 NAVIGATSIYA ---

bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

    if (data === "ignore_taken") {
        await ctx.answerCallbackQuery({ text: "Uzur, bu vaqt band!", show_alert: true });
        return;
    }

    if (data === "send_location") {
        await ctx.deleteMessage();
        await ctx.replyWithLocation(LOCATION.lat, LOCATION.lon);
        await ctx.reply("📍 **Manzil:** Andijon shahar, Leninskiy ko'cha 10-uy.\n\nMo'ljal: Eski shahar markazi.", {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "client_mode")
        });
        return;
    }

    if (data === "my_bookings") {
        const client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
        if (client.length === 0) {
            await ctx.answerCallbackQuery({ text: "Siz hali ro'yxatdan o'tmagansiz. /start bosing.", show_alert: true });
            return;
        }
        const apps = await sql`SELECT a.id, a.booking_date, a.start_time, m.full_name, s.name FROM appointments a JOIN masters m ON a.master_id = m.id JOIN services s ON a.service_id = s.id WHERE a.client_id = ${client[0].id} AND a.status = 'booked' AND a.booking_date >= NOW()::date ORDER BY a.booking_date, a.start_time`;
        if (apps.length === 0) {
            await ctx.editMessageText("Sizda faol bronlar yo'q.", { reply_markup: new InlineKeyboard().text("🔙 Orqaga", "client_mode") });
        } else {
            await ctx.deleteMessage();
            await ctx.reply("📋 **Sizning faol navbatlaringiz:**", { parse_mode: "Markdown" });
            for (const app of apps) {
                const date = new Date(app.booking_date).toLocaleDateString();
                await ctx.reply(`📅 ${date} | ⏰ ${app.start_time.slice(0,5)}\n👤 Usta: ${app.full_name}\n✂️ ${app.name}`, {
                    reply_markup: new InlineKeyboard().text("❌ Bekor qilish", `cancel_${app.id}`)
                });
            }
            await ctx.reply("----------------", { reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "client_mode") });
        }
        return;
    }

    if (data.startsWith("cancel_")) {
        const appId = data.split("_")[1];
        await sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${appId}`;
        await ctx.editMessageText("✅ **Navbat bekor qilindi.**\nVaqt boshqalar uchun ochildi.", { parse_mode: "Markdown" });
        try { await bot.api.sendMessage(ADMIN_ID, `⚠️ **Diqqat!**\nMijoz navbatini bekor qildi (ID: ${appId}).`); } catch(e){}
        return;
    }

    // Asosiy navigatsiya
    if (data.startsWith("goto_")) {
        ctx.session.step = data.substring(5);
    } else if (data === "client_mode") {
        ctx.session.step = "client_mode"; // <<< TUZATISH SHU YERDA
    } else if (data.startsWith("srv_")) {
        const p = data.split("_");
        ctx.session.serviceId = p[1];
        ctx.session.duration = parseInt(p[2]);
        ctx.session.step = "masters";
    } else if (data.startsWith("mst_")) {
        ctx.session.masterId = data.split("_")[1];
        ctx.session.step = "date";
    } else if (data.startsWith("date_")) {
        ctx.session.date = data.split("_")[1];
        ctx.session.step = "time";
    }
    
    // ✅ TASDIQLASH
    else if (data.startsWith("time_")) {
        const time = data.split("_")[1];
        try {
            let client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
            if (client.length === 0) {
                await sql`INSERT INTO clients (telegram_id, full_name, username) VALUES (${userId}, ${ctx.from.first_name}, ${ctx.from.username || null}) ON CONFLICT (telegram_id) DO NOTHING`;
                client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
                if (client.length === 0) throw new Error("Mijoz ID sini olishda xatolik.");
            }
            let [h, m] = time.split(":").map(Number);
            let totalMin = h * 60 + m + ctx.session.duration;
            let endH = Math.floor(totalMin / 60);
            let endM = totalMin % 60;
            let endTimeStr = `${endH < 10 ? '0'+endH : endH}:${endM < 10 ? '0'+endM : endM}:00`;
            await sql`INSERT INTO appointments (booking_date, start_time, end_time, master_id, client_id, service_id) VALUES (${ctx.session.date}, ${time+':00'}, ${endTimeStr}, ${ctx.session.masterId}, ${client[0].id}, ${ctx.session.serviceId})`;
            
            await ctx.deleteMessage();
            await ctx.reply(`✅ **Qabul qilindi!**\n\n📆 **Sana:** ${ctx.session.date}\n⏰ **Vaqt:** ${time}\n⏳ **Davomiylik:** ${ctx.session.duration} daqiqa\n\n📍 **Manzil:** Andijon shahar, Leninskiy ko'cha 10-uy.\n📞 **Aloqa:** +998 90 123 45 67`, { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "client_mode") });
            
            try { await bot.api.sendMessage(ADMIN_ID, `🆕 **Yangi Mijoz!**\nSana: ${ctx.session.date} | Vaqt: ${time}`); } catch(e){}
            ctx.session.step = "main";
            return;
        } catch (e) {
            console.error("BRON XATOSI:", e);
            if (e.code === '23505' || (e.message && e.message.includes("duplicate key"))) {
                 await ctx.answerCallbackQuery({ text: "Uzur, bu vaqt hozirgina band qilindi!", show_alert: true });
            } else {
                 await ctx.answerCallbackQuery({ text: "Tizimda xatolik yuz berdi. Qayta urinib ko'ring.", show_alert: true });
            }
            ctx.session.step = "time";
        }
    }

    const menu = await getMenu(userId, ctx.session.step, ctx);
    try { await ctx.editMessageText(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" }); } catch (e) {}
    await ctx.answerCallbackQuery();
});

// CRON JOB va boshqa kodlar...
cron.schedule('0 * * * *', async () => {
    try {
        const now = new Date();
        const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
        const startTime = `${nextHour.getHours().toString().padStart(2, '0')}:00:00`;
        const endTime = `${nextHour.getHours().toString().padStart(2, '0')}:59:59`;
        const upcoming = await sql`SELECT c.telegram_id, a.start_time, m.full_name FROM appointments a JOIN clients c ON a.client_id = c.id JOIN masters m ON a.master_id = m.id WHERE a.status = 'booked' AND a.booking_date = CURRENT_DATE AND a.start_time BETWEEN ${startTime} AND ${endTime}`;
        for (const app of upcoming) {
            await bot.api.sendMessage(Number(app.telegram_id), `⏰ **ESLATMA!**\n\nTaxminan 1 soatdan keyin (${app.start_time.slice(0,5)}) Master ${app.full_name} qabulidasiz.`, { parse_mode: "Markdown" });
        }
    } catch (e) { console.error("Cron xatosi:", e); }
});

bot.catch((err) => {
    console.error("Botda umumiy xatolik:", err);
});

async function startBot() {
    try {
        await bot.start();
        console.log("✂️ Barbershop PRO ishga tushdi!");
    } catch (e) {
        console.error("Botni ishga tushirishda xatolik:", e);
    }
}

startBot();
