const { Bot, InlineKeyboard, session } = require("grammy");
const postgres = require("postgres");
const cron = require("node-cron");
const http = require("http");

// --- ⚙️ SOZLAMALAR ---

// ✅ SIZNING TOKENINGIZ:
const BOT_TOKEN = "7863103574:AAEGC6y5ZuA4orbugd8Ssqiyv-sl4vSfvfs"; 

// ✅ SIZNING BAZA LINKINGIZ:
const DATABASE_URL = "postgresql://postgres.nqvzqndmtxqrvjtigzuw:BarberShopbot7777@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";

// ⚠️ ADMIN ID (6377333240):
const ADMIN_ID = 99999999; 

// Manzil
const LOCATION = { lat: 40.7821, lon: 72.3442 }; 

const bot = new Bot(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: "require" });

// Xotira
bot.use(session({ initial: () => ({ step: "main" }) }));

// Render Heartbeat
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

// VAQTLARNI HISOBLASH (🔴 QIZIL / 🟢 YASHIL)
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
        let timeSQL = `${h < 10 ? '0'+h : h}:${m < 10 ? '0'+m : m}:00`; 

        const isTaken = bookings.some(b => b.start_time === timeSQL);
        
        // Statusni ham qo'shamiz
        slots.push({ time: timeStr, status: isTaken ? 'taken' : 'free' });
        
        currentMin += duration; 
    }
    return slots;
}

// --- 🖥 MENYULAR ---
async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    // ADMIN
    if (userId === ADMIN_ID && step === "main") {
        text = "👑 **Admin Paneli**";
        keyboard.text("📊 Hisobot", "admin_report").row();
        keyboard.text("✂️ Mijoz rejimi", "client_mode");
        return { text, keyboard };
    }

    // MIJOZ
    if (step === "main" || step === "client_mode") {
        text = "💈 **Elegance Barbershop**\nZamonaviy soch turmaklari va sifatli xizmat!";
        keyboard.text("✂️ Navbat olish", "goto_services").row();
        keyboard.text("📍 Bizning manzil", "send_location").row();
        keyboard.text("👤 Mening bronlarim", "my_bookings");
    }
    else if (step === "services") {
        text = "Xizmatni tanlang:";
        const services = await sql`SELECT * FROM services`;
        services.forEach(s => keyboard.text(`${s.name} (${s.price})`, `srv_${s.id}_${s.duration}`).row());
        keyboard.text("🔙 Orqaga", "goto_main");
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
    }
    else if (step === "time") {
        text = "Vaqtni tanlang:\n(🔴 - Band, 🟢 - Bo'sh)";
        const slots = await getTimeSlots(ctx.session.masterId, ctx.session.date, ctx.session.duration);
        let r = 0;
        slots.forEach(s => { 
            if (s.status === 'free') {
                keyboard.text(`🟢 ${s.time}`, `time_${s.time}`);
            } else {
                keyboard.text(`🔴 ${s.time}`, `ignore_taken`);
            }
            r++; 
            if (r % 4 === 0) keyboard.row(); 
        });
        keyboard.row().text("🔙 Orqaga", "goto_date");
    }
    return { text, keyboard };
}

// --- 🤖 START ---
bot.command("start", async (ctx) => {
    ctx.session = { step: "main" };
    try { await sql`INSERT INTO clients (telegram_id, full_name, username) VALUES (${ctx.from.id}, ${ctx.from.first_name}, ${ctx.from.username}) ON CONFLICT (telegram_id) DO NOTHING`; } catch (e) {}
    const menu = await getMenu(ctx.from.id, "main", ctx);
    await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
});

// --- 🧭 NAVIGATSIYA ---
bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

    // BAND VAQT BOSILSA
    if (data === "ignore_taken") {
        await ctx.answerCallbackQuery({ text: "Uzur, bu vaqt band!", show_alert: true });
        return;
    }

    // MANZIL
    if (data === "send_location") {
        await ctx.deleteMessage();
        await ctx.replyWithLocation(LOCATION.lat, LOCATION.lon);
        await ctx.reply("📍 **Manzil:** Andijon shahar, Leninskiy ko'cha 10-uy.\n\nMo'ljal: Eski shahar markazi.", {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "goto_main")
        });
        return;
    }

    // MENING BRONLARIM
    if (data === "my_bookings") {
        const client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
        if (client.length === 0) return ctx.reply("Siz hali ro'yxatdan o'tmagansiz.");

        const apps = await sql`
            SELECT a.id, a.booking_date, a.start_time, m.full_name, s.name 
            FROM appointments a
            JOIN masters m ON a.master_id = m.id
            JOIN services s ON a.service_id = s.id
            WHERE a.client_id = ${client[0].id} AND a.status = 'booked' AND a.booking_date >= NOW()::date
            ORDER BY a.booking_date, a.start_time
        `;

        if (apps.length === 0) {
            await ctx.editMessageText("Sizda faol bronlar yo'q.", { reply_markup: new InlineKeyboard().text("🔙 Orqaga", "goto_main") });
        } else {
            await ctx.deleteMessage();
            await ctx.reply("📋 **Sizning faol navbatlaringiz:**", { parse_mode: "Markdown" });
            
            for (const app of apps) {
                const date = new Date(app.booking_date).toLocaleDateString();
                await ctx.reply(`📅 ${date} | ⏰ ${app.start_time.slice(0,5)}\n👤 Usta: ${app.full_name}\n✂️ ${app.name}`, {
                    reply_markup: new InlineKeyboard().text("❌ Bekor qilish", `cancel_${app.id}`)
                });
            }
            await ctx.reply("----------------", { reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "goto_main") });
        }
        return;
    }

    // BEKOR QILISH
    if (data.startsWith("cancel_")) {
        const appId = data.split("_")[1];
        await sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${appId}`;
        await ctx.editMessageText("✅ **Navbat bekor qilindi.**\nVaqt boshqalar uchun ochildi.", { parse_mode: "Markdown" });
        try { await bot.api.sendMessage(ADMIN_ID, `⚠️ **Diqqat!**\nMijoz navbatini bekor qildi (ID: ${appId}).`); } catch(e){}
        return;
    }

    // ODDJY NAVIGATSIYA
    if (data === "goto_main") ctx.session.step = "main";
    else if (data === "goto_services") ctx.session.step = "services";
    else if (data === "goto_date") ctx.session.step = "date";
    else if (data === "client_mode") ctx.session.step = "main";

    else if (data.startsWith("srv_")) {
        const p = data.split("_"); ctx.session.serviceId = p[1]; ctx.session.duration = parseInt(p[2]); ctx.session.step = "masters";
    }
    else if (data.startsWith("mst_")) {
        ctx.session.masterId = data.split("_")[1]; ctx.session.step = "date";
    }
    else if (data.startsWith("date_")) {
        ctx.session.date = data.split("_")[1]; ctx.session.step = "time";
    }
    
    // ✅ TASDIQLASH (CHIROYLI XABAR)
    else if (data.startsWith("time_")) {
        const time = data.split("_")[1];
        try {
            const client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
            let [h, m] = time.split(":").map(Number);
            let totalMin = h * 60 + m + ctx.session.duration;
            let endH = Math.floor(totalMin / 60);
            let endM = totalMin % 60;
            let endTimeStr = `${endH}:${endM < 10 ? '0'+endM : endM}:00`;
            
            await sql`INSERT INTO appointments (booking_date, start_time, end_time, master_id, client_id, service_id) 
                      VALUES (${ctx.session.date}, ${time}:00, ${endTimeStr}, ${ctx.session.masterId}, ${client[0].id}, ${ctx.session.serviceId})`;
            
            await ctx.deleteMessage();
            await ctx.reply(
                `✅ **Qabul qilindi!**\n\n` +
                `📆 **Sana:** ${ctx.session.date}\n` +
                `⏰ **Vaqt:** ${time}\n` +
                `⏳ **Davomiylik:** ${ctx.session.duration} daqiqa\n\n` +
                `📍 **Manzil:** Andijon shahar, Leninskiy ko'cha 10-uy.\n` + 
                `📞 **Aloqa:** +998 90 123 45 67`, 
                { 
                    parse_mode: "Markdown",
                    reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "goto_main")
                }
            );
            
            try { await bot.api.sendMessage(ADMIN_ID, `🆕 **Yangi Mijoz!**\nSana: ${ctx.session.date} | Vaqt: ${time}`); } catch(e){}
            
            ctx.session.step = "main";
            return;
        } catch (e) {
            await ctx.answerCallbackQuery({ text: "Bu vaqt band!", show_alert: true });
            return;
        }
    }

    const menu = await getMenu(userId, ctx.session.step, ctx);
    try { await ctx.editMessageText(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" }); } catch (e) {}
    await ctx.answerCallbackQuery();
});

// CRON JOB (ESLATMA)
cron.schedule('* * * * *', async () => {
    try {
        const upcoming = await sql`
            SELECT a.id, c.telegram_id, a.start_time, m.full_name
            FROM appointments a
            JOIN clients c ON a.client_id = c.id
            JOIN masters m ON a.master_id = m.id
            WHERE a.status = 'booked' 
            AND a.booking_date = CURRENT_DATE 
            AND a.start_time BETWEEN LOCALTIME + INTERVAL '59 minutes' AND LOCALTIME + INTERVAL '61 minutes'
        `;
        for (const app of upcoming) {
            await bot.api.sendMessage(Number(app.telegram_id), 
                `⏰ **ESLATMA!**\n\n1 soatdan keyin (${app.start_time.slice(0,5)}) Master ${app.full_name} qabulidasiz.`,
                { reply_markup: new InlineKeyboard().text("✅ Tushundim", "ok_rem") }
            );
        }
    } catch (e) { console.log("Cron xatosi:", e); }
});

bot.start();
console.log("✂️ Barbershop PRO ishga tushdi!");
