const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB ulangan!'))
  .catch(err => console.error(err));

// Modellar
const userSchema = new mongoose.Schema({ username: String, balance: {type: Number, default: 5000000}, gameCounter: {type: Number, default: 0} });
const botSchema = new mongoose.Schema({ name: String, balance: {type: Number, default: 20000000} });
const User = mongoose.model('User', userSchema);
const Bot = mongoose.model('Bot', botSchema);

// API: Garov tikish va soliq hisoblash
app.post('/api/place-bet', async (req, res) => {
    try {
        const { username, betAmount } = req.body;
        const user = await User.findOne({ username });
        const botNames = ["Bot_Alisher", "Bot_Madina", "Bot_Jasur", "Bot_Sardor", "Bot_Farrux"];
        const randomBotName = botNames[Math.floor(Math.random() * botNames.length)];
        const bot = await Bot.findOne({ name: randomBotName });

        if (user.balance < betAmount) return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });

        user.balance -= betAmount;
        bot.balance -= betAmount;
        user.gameCounter += 1;

        let totalPrize = betAmount * 2;
        let resultText = "";
        
        // 2 marta bot yutadi, 1 marta foydalanuvchi
        if (user.gameCounter % 3 !== 0) {
            bot.balance += totalPrize;
            resultText = `G'olib: ${randomBotName.replace('Bot_', '')}`;
        } else {
            // SOLIQ TIZIMI: 2% ushlab qolamiz
            let tax = Math.floor(totalPrize * 0.02);
            let netWin = totalPrize - tax;
            user.balance += netWin;
            resultText = `G'olib: ${user.username} (Soliq: ${tax} so'm ushlandi)`;
        }

        await user.save();
        await bot.save();
        
        res.json({ success: true, opponent: randomBotName, result: resultText, userBalance: user.balance });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Admin va sahifalar
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/users-list', async (req, res) => {
    const users = await User.find({});
    const bots = await Bot.find({});
    res.json({ success: true, users, bots });
});

app.post('/api/admin/manage-balance', async (req, res) => {
    const { username, action, amount } = req.body;
    let target = await User.findOne({ username }) || await Bot.findOne({ name: username });
    if(action === 'add') target.balance += parseInt(amount);
    else target.balance -= parseInt(amount);
    await target.save();
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000);
