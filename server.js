const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB modellari
const userSchema = new mongoose.Schema({ username: String, balance: {type: Number, default: 5000000}, gameCounter: {type: Number, default: 0} });
const botSchema = new mongoose.Schema({ name: String, balance: {type: Number, default: 20000000} });
const BankSchema = new mongoose.Schema({ totalBalance: Number, accumulatedTax: Number });

const User = mongoose.model('User', userSchema);
const Bot = mongoose.model('Bot', botSchema);
const Bank = mongoose.model('Bank', BankSchema);

// Bankni initsializatsiya qilish (agar yo'q bo'lsa)
async function initBank() {
    const bank = await Bank.findOne();
    if (!bank) await new Bank({ totalBalance: 100000000, accumulatedTax: 0 }).save();
}
initBank();

// API: Garov tikish
app.post('/api/place-bet', async (req, res) => {
    try {
        const { username, betAmount } = req.body;
        const user = await User.findOne({ username });
        const bank = await Bank.findOne();
        const bots = await Bot.find();
        const randomBot = bots[Math.floor(Math.random() * bots.length)];

        if (user.balance < betAmount) return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });

        user.balance -= betAmount;
        randomBot.balance -= betAmount;
        user.gameCounter += 1;

        let totalPrize = betAmount * 2;
        let resultText = "";

        if (user.gameCounter % 3 !== 0) {
            randomBot.balance += totalPrize;
            resultText = `G'olib: ${randomBot.name}`;
        } else {
            // Soliqni hisoblash (2%)
            let tax = Math.floor(totalPrize * 0.02);
            let netWin = totalPrize - tax;
            user.balance += netWin;
            bank.accumulatedTax += tax; // Soliq bankka to'planadi
            resultText = `G'olib: ${user.username}`;
            await bank.save();
        }

        await user.save();
        await randomBot.save();
        res.json({ success: true, opponent: randomBot.name, result: resultText, userBalance: user.balance });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Admin: Soliqni Bankka o'tkazish
app.post('/api/admin/transfer-tax', async (req, res) => {
    const bank = await Bank.findOne();
    bank.totalBalance += bank.accumulatedTax;
    bank.accumulatedTax = 0;
    await bank.save();
    res.json({ success: true, newTax: 0, bankBalance: bank.totalBalance });
});

// Admin: Boshqa funksiyalar (get/postlar) oldingidek qoladi
app.get('/api/stats', async (req, res) => {
    const bank = await Bank.findOne();
    const users = await User.find();
    const bots = await Bot.find();
    res.json({ bank, users, bots });
});

// ... (oldingi admin va user list kodlari) ...
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/users-list', async (req, res) => {
    const users = await User.find({});
    const bots = await Bot.find({});
    const bank = await Bank.findOne();
    res.json({ success: true, users, bots, bank });
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
