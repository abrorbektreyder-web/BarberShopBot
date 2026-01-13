const { Bot, InlineKeyboard, session } = require("grammy");
const postgres = require("postgres");
const cron = require("node-cron");

// 1. SIZNING MA'LUMOTLARINGIZ (To'g'rilandi ✅)
const BOT_TOKEN = "7863103574:AAEGC6y5ZuA4orbugd8Ssqiyv-sl4vSfvfs"; 
const DATABASE_URL = "postgresql://postgres.nqvzqndmtxqrvjtigzuw:BarberShopbot7777@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";
const ADMIN_ID = 99999999; // O'zingizning ID raqamingizni keyinroq yozarsiz

// Andijon markazi
const LOCATION = { lat: 40.7821, lon: 72.3442 }; 

const bot = new Bot(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: "require" });

// Xotira
bot.use(session({ initial: () => ({ step: "main" }) }));

// --- 📅 YORDAMCHI: Haftalik Kalendar ---
function getWeekKeyboard() {
    const keyboard = new InlineKeyboard();
    const days = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Juma", "Shan"];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + i);
        
        const dayName = days[nextDate.getDay()];
        const dayNum = nextDate.getDate();
        const month = nextDate.getMonth() + 1;
        
        const dateStr = nextDate.toISOString().split('T')[0];
        const btnText = `${dayNum}.${month < 10 ? '0'+month : month} (${dayName})`;
        
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

        if (!isTaken) {
            slots.push(timeStr);
        }
        currentMin += duration; 
    }
    return slots;
}

// --- 🖥 MENYULAR ---
async function getMenu(userId, step, ctx) {
    let text = "";
    let keyboard = new InlineKeyboard();

    try {
        if (step === "main") {
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
    } catch (e) {
        console.log(e);
        text = "Xatolik!";
    }
    return { text, keyboard };
}

// --- 🤖 BOT START ---
bot.command("start", async (ctx) => {
    ctx.session = { step: "main" };
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
            
            try { await bot.api.sendMessage(ADMIN_ID, `🆕 Yangi Mijoz!\nSana: ${ctx.session.date} | Vaqt: ${time}`); } catch(e){}
            
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
console.log("✂️ Barbershop Boti ishga tushdi!");
// --- RENDER UCHUN MAXSUS KOD (Eshikni ochish) ---
const http = require("http");
http.createServer((req, res) => {
    res.write("Barbershop Boti ishlayapti!");
    res.end();
}).listen(process.env.PORT || 3000);
