const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware sozlamalari
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. MONGODB'GA ULANISH
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB-ga muvaffaqiyatli ulandi!'))
  .catch(err => console.error('MongoDB ulanishida xato:', err));

// 2. MA'LUMOTLAR MODELLARI (SCHEMAS)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    balance: { type: Number, default: 5000000 },
    gameCounter: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const botSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    balance: { type: Number, default: 15000000 }
});
const Bot = mongoose.model('Bot', botSchema);

// 3. SAHIFALARNI YUKLASH (ROUTES)
// O'yinning asosiy oynasi
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin panel oynasi (Xatolikni oldini olish uchun)
app.get('/admin-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Hamma foydalanuvchilar va botlarni jadval uchun olish API
app.get('/api/users-list', async (req, res) => {
    try {
        const users = await User.find({});
        const bots = await Bot.find({});
        res.json({ success: true, users, bots });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 4. LOGIN / REGISTER API
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

// BAZADA BOTLARNI AVTOMATIK YARATISH
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

// 5. GAROV TIKISH VA CHIRKIDAGI ALDOV MANTIQLARI (0 soniya kutish)
app.post('/api/place-bet', async (req, res) => {
    try {
        const { username, betAmount } = req.body;
        const parsedBet = parseInt(betAmount);

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi!" });
        
        if (user.balance < parsedBet) {
            return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
        }

        // QOIDA: Botlar faqat 700,000 va 1,000,000 so'mlik garovlarda o'ynaydi
        if (parsedBet < 700000) {
            return res.status(400).json({ success: false, message: "Raqiblar faqat 700,000 va 1,000,000 so'mlik garovlarni qabul qilishadi!" });
        }

        const botNames = ["Alisher", "Madina", "Jasur", "Sardor", "Farrux"];
        const randomBotName = botNames[Math.floor(Math.random() * botNames.length)];
        const bot = await Bot.findOne({ name: `Bot_${randomBotName}` });

        if (!bot || bot.balance < parsedBet) {
            return res.status(400).json({ success: false, message: "Hozircha bo'sh raqib topilmadi!" });
        }

        // Garov tikilishi bilan pullar darhol ayiriladi
        user.balance -= parsedBet;
        bot.balance -= parsedBet;
        const totalPrize = parsedBet * 2;

        user.gameCounter += 1;
        let userScore, botScore, gameResultText;

        // QOIDA: 2 marta bot yutadi, 1 marta foydalanuvchi yutadi
        if (user.gameCounter % 3 !== 0) {
            botScore = Math.floor(Math.random() * 3) + 10;
            userScore = Math.floor(Math.random() * 5) + 2;
            bot.balance += totalPrize;
            gameResultText = `G'olib: ${randomBotName}`;
        } else {
            userScore = Math.floor(Math.random() * 3) + 10;
            botScore = Math.floor(Math.random() * 5) + 2;
            user.balance += totalPrize;
            gameResultText = `G'olib: ${user.username}`;
        }

        await user.save();
        await bot.save();

        res.json({
            success: true,
            opponent: randomBotName, 
            userScore,
            botScore,
            result: gameResultText,
            userBalance: user.balance,
            botBalance: bot.balance
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Serverda ichki xatolik yuz berdi" });
    }
});

// 6. ADMIN PANEL APISALARI
app.post('/api/admin/manage-balance', async (req, res) => {
    try {
        const { username, action, amount } = req.body;
        const parsedAmount = parseInt(amount);

        let target = await User.findOne({ username });
        if (!target) {
            target = await Bot.findOne({ name: username });
        }

        if (!target) return res.status(404).json({ success: false, message: "Profil topilmadi!" });

        if (action === "add") {
            target.balance += parsedAmount;
        } else if (action === "withdraw") {
            target.balance -= parsedAmount;
        }

        await target.save();
        res.json({ success: true, message: "Balans yangilandi!", newBalance: target.balance });
    } catch (error) {
        res.status(500).json({ success: false, message: "Xatolik yuz berdi" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
