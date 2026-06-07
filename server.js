const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// O'rta dasturlar (Middleware)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // public papkasidagi CSS/JS fayllar uchun

// 1. MONGODB'GA ULANISH
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB-ga muvaffaqiyatli ulandi!'))
  .catch(err => console.error('MongoDB ulanishida xato:', err));

// 2. MA'LUMOTLAR MODELLARI (SCHEMAS)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    balance: { type: Number, default: 5000000 }, // Yangi foydalanuvchiga 5 mln so'm start puli
    gameCounter: { type: Number, default: 0 }    // O'yinlar sonini hisoblash (2 ta yutqazib, 1 ta yutish uchun)
});
const User = mongoose.model('User', userSchema);

const botSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    balance: { type: Number, default: 15000000 } // Botlarning boshlang'ich balansi
});
const Bot = mongoose.model('Bot', botSchema);


// 3. ASOSIY SAHIFANI YUKLASH (Cannot GET / xatoligini oldini olish uchun)
app.get('/', (req, res) => {
    // Agar index.html faylingiz shundoq bosh papkada bo'lsa:
    res.sendFile(path.join(__dirname, 'index.html'));
    
    // AGAR index.html faylingiz 'public' papkasi ichida bo'lsa, yuqoridagi qatorni o'chirib,
    // pastdagi qatorni ochib qo'ying:
    // res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// 4. FOYDALANUVCHINI TIZIMGA KIRITISH (LOGIN / REGISTER)
app.post('/api/login', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ success: false, message: "Ism kiritilmadi!" });

        let user = await User.findOne({ username });
        if (!user) {
            user = new User({ username });
            await user.save();
        }
        res.json({ success: true, username: user.username, balance: user.balance });
    } catch (error) {
        res.status(500).json({ success: false, message: "Tizimda xatolik yuz berdi" });
    }
});


// 5. BAZADA BOTLARNAVTOMATIK YARATISH (Agar bazada yo'q bo'lsa)
async function createBotsIfNotExist() {
    const defaultBots = ["Bot_Alisher", "Bot_Madina", "Bot_Jasur", "Bot_Sardor", "Bot_Farrux"];
    for (let botName of defaultBots) {
        const exist = await Bot.findOne({ name: botName });
        if (!exist) {
            await new Bot({ name: botName, balance: 20000000 }).save();
        }
    }
}
createBotsIfNotExist();


// 6. ENGL ASOSIY QISM: GAROV TIKISH VA O'YIN MANTIQI (0 soniya kutish va aldov algoritmi)
app.post('/api/place-bet', async (req, res) => {
    try {
        const { username, betAmount } = req.body;
        const parsedBet = parseInt(betAmount);

        // Foydalanuvchini tekshirish
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi!" });
        
        if (user.balance < parsedBet) {
            return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
        }

        // QOIDA 1: Botlar faqat 700,000 va 1,000,000 so'mlik garovlarda o'ynaydi
        if (parsedBet < 700000) {
            return res.status(400).json({ success: false, message: "Raqiblar faqat 700,000 va 1,000,000 so'mlik garovlarni qabul qilishadi!" });
        }

        // Tasodifiy bitta botni tanlash
        const botNames = ["Alisher", "Madina", "Jasur", "Sardor", "Farrux"];
        const randomBotName = botNames[Math.floor(Math.random() * botNames.length)];
        const bot = await Bot.findOne({ name: `Bot_${randomBotName}` });

        if (!bot || bot.balance < parsedBet) {
            return res.status(400).json({ success: false, message: "Hozircha bo'sh raqib topilmadi, qayta urinib ko'ring!" });
        }

        // QOIDA 2: O'yin boshlanishi bilanoq ikkala tomondan ham pul ayiriladi
        user.balance -= parsedBet;
        bot.balance -= parsedBet;
        const totalPrize = parsedBet * 2; // O'yin jamg'armasi

        // O'yinlar hisoblagichini oshiramiz
        user.gameCounter += 1;

        let userScore, botScore;
        let gameResultText = "";

        // QOIDA 3 & 4: Bot 2 marta yutib, 1 marta yutqazadi (Sikl: 1-bot yutadi, 2-bot yutadi, 3-Siz yutasiz)
        if (user.gameCounter % 3 !== 0) {
            // BOT YUTADI (2 marta)
            botScore = Math.floor(Math.random() * 3) + 10; // Bot ochkosi baland (10-12)
            userScore = Math.floor(Math.random() * 5) + 2;  // Sizning ochkongiz past (2-6)
            
            bot.balance += totalPrize; // Bot pulni yutib oldi
            gameResultText = `G'olib: ${randomBotName}`; // Foydalanuvchiga "Bot_" so'zisiz ko'rsatiladi!
        } else {
            // SIZ YUTASIZ (1 marta)
            userScore = Math.floor(Math.random() * 3) + 10; // Sizning ochkongiz baland (10-12)
            botScore = Math.floor(Math.random() * 5) + 2;  // Bot ochkosi past (2-6)
            
            user.balance += totalPrize; // Siz pulni yutib oldingiz
            gameResultText = `G'olib: ${user.username}`;
        }

        // Natijalarni bazada yangilash (Botning ham, Sizning ham pulingiz to'g'ri hisoblandi)
        await user.save();
        await bot.save();

        // Natijani darhol (0 soniyada) frontandga qaytarish
        res.json({
            success: true,
            opponent: randomBotName, // Raqib ismi (Foydalanuvchi buni haqiqiy odam deb o'ylaydi)
            userScore,
            botScore,
            result: gameResultText,
            userBalance: user.balance,
            botBalance: bot.balance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Serverda ichki xatolik yuz berdi" });
    }
});


// 7. ADMIN PANEL UCHUN BALANS BOSHQARISH (Depozit va Chiqarish)
app.post('/api/admin/manage-balance', async (req, res) => {
    try {
        const { username, action, amount } = req.body;
        const parsedAmount = parseInt(amount);

        let target = await User.findOne({ username });
        if (!target) {
            target = await Bot.findOne({ name: username }); // Agar foydalanuvchi bo'lmasa, botlardan qidiradi
        }

        if (!target) return res.status(404).json({ success: false, message: "Profil topilmadi!" });

        if (action === "add") {
            target.balance += parsedAmount;
        } else if (action === "withdraw") {
            target.balance -= parsedAmount;
        }

        await target.save();
        res.json({ success: true, message: "Balans muvaffaqiyatli yangilandi!", newBalance: target.balance });
    } catch (error) {
        res.status(500).json({ success: false, message: "Xatolik yuz berdi" });
    }
});


// PORTNI ESHITISH
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda mukammal rejimda ishlamoqda...`);
});
