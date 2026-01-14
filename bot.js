const { Bot, InlineKeyboard, Keyboard, session } = require("grammy");
const postgres = require("postgres");
const cron = require("node-cron");
const http = require("http");

// --- ⚙️ SOZLAMALAR ---
const BOT_TOKEN = "7863103574:AAH-XfL9SDjVrZf92wl5FsE3GluxdmwipPs";
const DATABASE_URL = "postgresql://postgres.nqvzqndmtxqrvjtigzuw:BarberShopbot7777@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";
const ADMIN_ID = 6377333240; 
const LOCATION = { lat: 40.7821, lon: 72.3442 }; 

const bot = new Bot(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: "require" });

// Session
bot.use(session({ initial: () => ({ step: "main" }) }));

// Server
http.createServer((req, res) => { res.write("OK"); res.end(); }).listen(process.env.PORT || 3000);

// --- YORDAMCHI FUNKSIYALAR ---

async function autoUpdateDatabase() {
    try {
        await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_number TEXT`;
    } catch (e) { console.error(e); }
}

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
    keyboard.row().text("🔙 Orqaga", "goto_masters");
    return keyboard;
}

async function getTimeSlots(masterId, dateStr, duration) {
    try {
        const master = await sql`SELECT start_time, end_time FROM masters WHERE id = ${masterId}`;
        if (master.length === 0) return [];

        const bookings = await sql`SELECT start_time FROM appointments WHERE master_id = ${masterId} AND booking_date = ${dateStr} AND status != 'cancelled'`;

        let slots = [];
        let currentMin = master[0].start_time * 60;
        let endMin = master[0].end_time * 60;

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
    } catch (e) { return []; }
}

async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    // --- ADMIN PANELI ---
    if (userId === ADMIN_ID && step === "main") {
        text = "👑 **Admin Paneli**\n\nNima qilamiz, xo'jayin?";
        keyboard.text("📢 Xabar yuborish (Reklama)", "admin_broadcast").row();
        keyboard.text("✂️ Mijoz rejimi (Botni tekshirish)", "client_mode");
        return { text, keyboard };
    }

    // --- MIJOZ MENYUSI ---
    if (step === "main" || step === "client_mode") {
        text = "💈 **Elegance Barbershop**\nZamonaviy soch turmaklari va sifatli xizmat!";
        keyboard.text("✂️ Navbat olish", "goto_services").row();
        keyboard.text("📍 Bizning manzil", "send_location").row();
        keyboard.text("👤 Mening bronlarim", "my_bookings");
        if (userId === ADMIN_ID) keyboard.row().text("👑 Admin paneliga", "goto_main");
    }
    else if (step === "services") {
        text = "Xizmatni tanlang:";
        const services = await sql`SELECT * FROM services`;
        services.forEach(s => keyboard.text(`${s.name} (${s.price})`, `srv_${s.id}_${s.duration}_${s.name}`).row());
        keyboard.text("🔙 Orqaga", userId === ADMIN_ID ? "client_mode" : "goto_main");
    }
    else if (step === "masters") {
        text = "Usta tanlang:";
        const masters = await sql`SELECT * FROM masters`;
        masters.forEach(m => keyboard.text(m.full_name, `mst_${m.id}_${m.full_name}`).row());
        keyboard.text("🔙 Orqaga", "goto_services");
    }
    else if (step === "date") {
        text = "Kunni tanlang:";
        keyboard = getWeekKeyboard();
    }
    else if (step === "time") {
        text = "Vaqtni tanlang:\n(🔴 - Band, 🟢 - Bo'sh)";
        const slots = await getTimeSlots(ctx.session.masterId, ctx.session.date, ctx.session.duration);
        if (slots.length > 0) {
            let r = 0;
            slots.forEach(s => { 
                if (s.status === 'free') keyboard.text(`🟢 ${s.time}`, `prebook_${s.time}`);
                else keyboard.text(`🔴 ${s.time}`, `ignore_taken`);
                r++; if (r % 4 === 0) keyboard.row(); 
            });
        } else { text = "Uzur, bu kunga bo'sh vaqtlar topilmadi."; }
        keyboard.row().text("🔙 Orqaga", "goto_date");
    }
    else if (step === "confirm_booking") {
        text = `📝 **Ma'lumotlarni tekshiring:**\n\n✂️ Xizmat: **${ctx.session.serviceName}**\n👤 Usta: **${ctx.session.masterName}**\n📅 Sana: **${ctx.session.date}**\n⏰ Vaqt: **${ctx.session.time}**\n\nBarchasi to'g'rimi?`;
        keyboard.text("✅ Tasdiqlash", "confirm_final").row();
        keyboard.text("❌ Bekor qilish", "cancel_process");
    }
    // --- YANGI: REKLAMA YUBORISH MENYUSI ---
    else if (step === "admin_broadcast_wait") {
        text = "📢 **Reklama yoki Tabrik yuborish**\n\nMijozlarga yubormoqchi bo'lgan xabaringizni shu yerga yozing (Rasm, Video yoki Matn yuborishingiz mumkin).\n\n_Bekor qilish uchun tugmani bosing._";
        keyboard.text("❌ Bekor qilish", "goto_main");
    }

    return { text, keyboard };
}

async function executeBooking(ctx, userId) {
    try {
        let client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
        if (client.length === 0) throw new Error("Mijoz topilmadi");

        const time = ctx.session.time;
        let [h, m] = time.split(":").map(Number);
        let totalMin = h * 60 + m + ctx.session.duration;
        let endH = Math.floor(totalMin / 60);
        let endM = totalMin % 60;
        let endTimeStr = `${endH < 10 ? '0'+endH : endH}:${endM < 10 ? '0'+endM : endM}:00`;

        await sql`INSERT INTO appointments (booking_date, start_time, end_time, master_id, client_id, service_id) 
                  VALUES (${ctx.session.date}, ${time+':00'}, ${endTimeStr}, ${ctx.session.masterId}, ${client[0].id}, ${ctx.session.serviceId})`;

        await ctx.reply(`✅ **Qabul qilindi!**\n\n📅 Sana: ${ctx.session.date}\n⏰ Vaqt: ${time}\n✂️ Xizmat: ${ctx.session.serviceName}\n👤 Usta: ${ctx.session.masterName}\n\n📍 Manzil: Andijon shahar.`, 
                        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } });
        
        try { 
            const userPhone = (await sql`SELECT phone_number FROM clients WHERE id = ${client[0].id}`)[0].phone_number;
            await bot.api.sendMessage(ADMIN_ID, `🆕 **Yangi Bron!**\nSana: ${ctx.session.date} | Vaqt: ${time}\nMijoz: ${ctx.from.first_name}\nTel: ${userPhone || 'Yo\'q'}`); 
        } catch(e){}

        ctx.session.step = "main";
        const menu = await getMenu(userId, "main", ctx);
        await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });

    } catch (e) {
        if (e.code === '23505' || (e.message && e.message.includes("duplicate key"))) {
            await ctx.reply("⚠️ Uzur, bu vaqt hozirgina band qilindi! Boshqa vaqt tanlang.");
        } else {
            await ctx.reply("⚠️ Tizimda xatolik yuz berdi.");
        }
        ctx.session.step = "time";
        const menu = await getMenu(userId, "time", ctx);
        await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
    }
}

// --- COMMAND HANDLERS ---
bot.command("start", async (ctx) => {
    ctx.session = { step: "main" };
    try {
        await sql`INSERT INTO clients (telegram_id, full_name, username) VALUES (${ctx.from.id}, ${ctx.from.first_name}, ${ctx.from.username || null}) ON CONFLICT (telegram_id) DO NOTHING`; 
    } catch (e) { }

    const menu = await getMenu(ctx.from.id, "main", ctx);
    await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
});

// --- ADMIN REKLAMA LOGIKASI ---
bot.on("message", async (ctx, next) => {
    // Agar Admin "Reklama yuborish" rejimida bo'lsa va xabar yozsa
    if (ctx.from.id === ADMIN_ID && ctx.session.step === "admin_broadcast_wait") {
        const users = await sql`SELECT telegram_id FROM clients`;
        
        await ctx.reply(`📢 Xabar yuborish boshlandi...\nJami mijozlar: ${users.length} ta.`);
        
        let sent = 0;
        let blocked = 0;

        for (const user of users) {
            try {
                // Xabarni nusxalab yuborish (CopyMessage - rasm, video, matn hammasi o'tadi)
                await ctx.copyMessage(Number(user.telegram_id));
                sent++;
            } catch (e) {
                blocked++;
            }
            // Telegramni "spam" qilmaslik uchun ozgina kutish
            await new Promise(r => setTimeout(r, 50)); 
        }

        await ctx.reply(`✅ **Hisobot:**\n\n📤 Yuborildi: ${sent} ta\n🚫 Bloklaganlar: ${blocked} ta\n\nJarayon tugadi.`);
        
        ctx.session.step = "main";
        const menu = await getMenu(ADMIN_ID, "main", ctx);
        await ctx.reply(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
        return;
    }
    // Agar reklama bo'lmasa, oddiy logika davom etadi
    await next();
});

// --- KONTAKT VA MATN HANDLERLAR ---
bot.on("message:contact", async (ctx) => {
    if (ctx.session.step === "waiting_for_phone") {
        const phone = ctx.message.contact.phone_number;
        const userId = ctx.from.id;
        await sql`UPDATE clients SET phone_number = ${phone} WHERE telegram_id = ${userId}`;
        await ctx.reply("✅ Raqam saqlandi.", { reply_markup: { remove_keyboard: true } });
        await executeBooking(ctx, userId);
    }
});

bot.on("message:text", async (ctx) => {
    if (ctx.session.step === "waiting_for_phone") {
        const text = ctx.message.text;
        if (text.length >= 7 && /^[+0-9\s]+$/.test(text)) {
            const userId = ctx.from.id;
            await sql`UPDATE clients SET phone_number = ${text} WHERE telegram_id = ${userId}`;
            await ctx.reply(`✅ Raqam saqlandi: ${text}`, { reply_markup: { remove_keyboard: true } });
            await executeBooking(ctx, userId);
        } else {
            await ctx.reply("⚠️ Iltimos, to'g'ri telefon raqam kiriting yoki tugmani bosing.");
        }
    }
});

bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;

    if (data === "ignore_taken") return ctx.answerCallbackQuery({ text: "Band!", show_alert: true });

    // --- ADMIN TUGMALARI ---
    if (data === "admin_broadcast") {
        ctx.session.step = "admin_broadcast_wait";
        const menu = await getMenu(userId, "admin_broadcast_wait", ctx);
        await ctx.editMessageText(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" });
        return;
    }
    if (data === "goto_main") {
        ctx.session.step = "main"; // Asosiy menyuga qaytish
    }

    if (data === "send_location") {
        await ctx.deleteMessage();
        await ctx.replyWithLocation(LOCATION.lat, LOCATION.lon);
        await ctx.reply("📍 **Manzil:** Andijon shahar.", {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text("🔙 Bosh menyu", "client_mode")
        });
        return;
    }
    if (data === "my_bookings") {
        const client = await sql`SELECT id FROM clients WHERE telegram_id = ${userId}`;
        if (client.length === 0) return ctx.answerCallbackQuery({ text: "Ro'yxatdan o'tmagansiz.", show_alert: true });
        
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
        if (data === "cancel_process") {
             ctx.session.step = "time";
             await ctx.answerCallbackQuery({ text: "Bron bekor qilindi" });
        } else {
            const appId = data.split("_")[1];
            await sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${appId}`;
            await ctx.editMessageText("✅ **Navbat bekor qilindi.**", { parse_mode: "Markdown" });
            try { await bot.api.sendMessage(ADMIN_ID, `⚠️ Mijoz navbatini bekor qildi.`); } catch(e){}
            return;
        }
    }

    if (data.startsWith("goto_")) ctx.session.step = data.substring(5);
    else if (data === "client_mode") ctx.session.step = "client_mode";
    else if (data.startsWith("srv_")) {
        const p = data.split("_");
        ctx.session.serviceId = p[1];
        ctx.session.duration = parseInt(p[2]);
        ctx.session.serviceName = p[3];
        ctx.session.step = "masters";
    } 
    else if (data.startsWith("mst_")) {
        const p = data.split("_");
        ctx.session.masterId = p[1];
        ctx.session.masterName = p[2];
        ctx.session.step = "date";
    } 
    else if (data.startsWith("date_")) {
        ctx.session.date = data.split("_")[1];
        ctx.session.step = "time";
    } 
    else if (data.startsWith("prebook_")) {
        const time = data.split("_")[1];
        ctx.session.time = time;
        ctx.session.step = "confirm_booking";
    } 
    else if (data === "confirm_final") {
        let client = await sql`SELECT phone_number FROM clients WHERE telegram_id = ${userId}`;
        if (client.length === 0) {
            await sql`INSERT INTO clients (telegram_id, full_name, username) VALUES (${userId}, ${ctx.from.first_name}, ${ctx.from.username || null})`;
            client = [{ phone_number: null }];
        }
        
        if (client[0].phone_number) {
             await ctx.deleteMessage();
             await executeBooking(ctx, userId);
             return;
        } else {
             ctx.session.step = "waiting_for_phone";
             await ctx.deleteMessage();
             const keyboard = new Keyboard().requestContact("📞 Raqamimni ulashish").resized().oneTime();
             await ctx.reply("Hurmatli mijoz, bronni tasdiqlash uchun telefon raqamingiz kerak.\n\n1️⃣ Pastdagi tugmani bosing (Oson).\n2️⃣ YOKI raqamingizni yozib yuboring (+998901234567).", { reply_markup: keyboard, parse_mode: "Markdown" });
             return;
        }
    }

    const menu = await getMenu(userId, ctx.session.step, ctx);
    try { await ctx.editMessageText(menu.text, { reply_markup: menu.keyboard, parse_mode: "Markdown" }); } catch (e) {}
    await ctx.answerCallbackQuery();
});

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
    } catch (e) { }
});

bot.catch((err) => { console.error(`Xatolik:`, err.error); });

async function startBot() {
    await autoUpdateDatabase();
    try {
        await bot.api.setMyCommands([ { command: "start", description: "🏠 Bosh menyu" } ]);
        await bot.start();
        console.log("✂️ Barbershop PRO ishga tushdi!");
    } catch (e) { console.error("Start xatosi:", e); }
}

startBot();
