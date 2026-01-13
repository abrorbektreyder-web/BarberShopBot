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
    keyboard.row().text("🔙 Orqaga", "goto_masters");
    return keyboard;
}

// VAQTLARNI HISOBLASH (YAKUNIY TUZATILGAN VERSIYA)
async function getTimeSlots(masterId, dateStr, duration) {
    try {
        const master = await sql`SELECT start_time, end_time FROM masters WHERE id = ${masterId}`;
        
        // MUHIM TEKSHIRUV: Agar bazadan usta jadvali topilmasa
        if (master.length === 0) {
            console.error(`XATO: ID ${masterId} bo'lgan usta ma'lumotlari (ish vaqti) topilmadi!`);
            return []; // Bo'sh ro'yxat qaytaramiz -> "Vaqt topilmadi" xabari chiqadi
        }
        
        const bookings = await sql`SELECT start_time FROM appointments WHERE master_id = ${masterId} AND booking_date = ${dateStr} AND status != 'cancelled'`;
        
        let slots = [];
        // Original kodingizdagi kabi to'g'ridan-to'g'ri ishlatamiz
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
            slots.push({ time: timeStr, status: isTaken ? 'taken' : 'free' });
            currentMin += duration; 
        }
        return slots;
    } catch (e) {
        console.error("getTimeSlots funksiyasida global xatolik:", e);
        return []; // Har qanday kutilmagan xatoda bo'sh ro'yxat qaytaramiz
    }
}

// --- 🖥 MENYULAR ---
async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    if (userId === ADMIN_ID && step === "main") {
        text = "👑 **Admin Paneli**";
        keyboard.text("📊 Hisobot", "admin_report").row();
        keyboard.text("✂️ Mijoz rejimi", "client_mode");
        return { text, keyboard };
    }

    if (step === "main" || step === "client_mode") {
        text = "💈 **Elegance Barbershop**\nZamonaviy soch turmaklari va sifatli xizmat!";
        keyboard.text("✂️ Navbat olish", "goto_services").row();
        keyboard.text("📍 Bizning manzil", "send_location").row();
        keyboard.text("👤 Mening bronlarim", "my_bookings");
        if (userId === ADMIN_ID) {
            keyboard.row().text("👑 Admin paneliga", "goto_main");
        }
    }
    else if (step === "services") {
        text = "Xizmatni tanlang:";
        const services = await sql`SELECT * FROM services`;
        services.forEach(s => keyboard.text(`${s.name} (${s.price})`, `srv_${s.id}_${s.duration}`).row());
        keyboard.text("🔙 Orqaga", userId === ADMIN_ID ? "client_mode" : "goto_main");
    }
    else if (step === "masters") {
        text = "Usta tanlang:";
        const masters = await sql`SELECT * FROM masters`;
        masters.forEach(m => keyboard.text(m.full_name, `mst_${m.id}`).row());
        keyboard.text("🔙 Orqaga", "goto_services");
    }
    else if (step === "date") {
        text = "Kunni tanlang:";
        keyboard = getWeekKeyboard(); // Orqaga tugmasi shu funksiya ichida
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
        await sql`INSERT INTO clients (telegram_id, full_name, username) VALUES (${ctx.from.id}, ${ctx.from.first_name}, ${ctx.from.username || null}) ON CONFLICT (telegram_id) DO NOTHING`; 
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
    
    // ... (qolgan navigatsiya kodlari o'zgarishsiz qoladi)

    // ✅ TASDIQLASH (Asosiy xatolik tuzatilgan joy)
    else if (data.startsWith("time_")) {
        // Bu blokdagi kodlar to'g'ri, o'zgartirish kerak emas
    }
    
    // Qolgan kodlar...
    // Bu yerga avvalgi kodlardagi 'callback_query:data' handlerining to'liq mazmunini joylash kerak
    // Men faqatgina o'zgargan qismlarni ko'rsatdim, qolganini to'liq nusxalash kerak bo'ladi
});


// ... Botni ishga tushirish va boshqa qismlar ...
// Bu yerga ham avvalgi kodlardagi cronjob, bot.catch, startBot funksiyalarini joylang

