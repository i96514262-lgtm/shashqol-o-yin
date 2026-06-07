const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log('MongoDB muvaffaqiyatli ulandi!');
      await baziInitsializatsiya(); // Baza sozlamalarini to'g'rilash
  })
  .catch(err => console.error('Baza ulanishida xatolik:', err));

// SCHEMAS
const UserSchema = new mongoose.Schema({ 
    username: String, 
    balance: { type: Number, default: 5000000 }, 
    gameCounter: { type: Number, default: 0 } 
});
const BotSchema = new mongoose.Schema({ 
    name: String, 
    balance: { type: Number, default: 20000000 } 
});
const BankSchema = new mongoose.Schema({ 
    totalBalance: { type: Number, default: 100000000 }, 
    accumulatedTax: { type: Number, default: 0 } 
});
const HistorySchema = new mongoose.Schema({ 
    match: String, 
    amount: Number, 
    winner: String, 
    time: { type: Date, default: Date.now } 
});

const User = mongoose.model('User', UserSchema);
const Bot = mongoose.model('Bot', BotSchema);
const Bank = mongoose.model('Bank', BankSchema);
const History = mongoose.model('History', HistorySchema);

let activeRooms = [];

// ⚙️ BAZANI TOZALASH VA FAQAT 3 TA BOTNI SAQLASH FUNKSIYASI
async function baziInitsializatsiya() {
    // 1. Odamlar ro'yxatidan tasodifan ochilib qolgan barcha soxta "Bot_" ismlarni o'chirish
    await User.deleteMany({ username: { $regex: /bot/i } });
    
    // 2. Eski botlarni tozalab, faqat siz aytgan 3 ta botni yaratish
    await Bot.deleteMany({});
    const fixedBots = ['Muxa 1', 'Muxa 2', 'Muxa 3'];
    for (let botName of fixedBots) {
        await new Bot({ name: botName, balance: 20000000 }).save();
    }
    
    // 3. Bank tizimini tekshirish
    let bank = await Bank.findOne();
    if (!bank) {
        await new Bank({ totalBalance: 100000000, accumulatedTax: 0 }).save();
    }
    console.log("Bazadagi botlar va tizim muvaffaqiyatli optimizatsiya qilindi!");
}

// 🤖 BOTLARNING 24/7 O'ZARO O'YINI (BALANS KO'PAYMAYDI - DOIMIY TURADI)
setInterval(async () => {
    try {
        const bots = await Bot.find({});
        if (bots.length < 2) return;

        let b1 = bots[Math.floor(Math.random() * bots.length)];
        let b2 = bots[Math.floor(Math.random() * bots.length)];
        while (b1.name === b2.name) { 
            b2 = bots[Math.floor(Math.random() * bots.length)]; 
        }

        const amounts = [40000, 100000, 300000, 700000, 1000000];
        let randomAmount = amounts[Math.floor(Math.random() * amounts.length)];

        // Botlar o'zaro o'ynaganda kassa shishib ketmasligi uchun teng taqsimlanadi
        b1.balance -= randomAmount;
        b2.balance -= randomAmount;

        let winner = Math.random() > 0.5 ? b1 : b2;
        winner.balance += (randomAmount * 2); // Pullar ko'paymaydi, o'z holicha qaytadi
        
        await b1.save();
        await b2.save();
    } catch (e) { console.log("Botlar o'yinida xatolik"); }
}, 5000);

// ⏳ 20 SONIYALIK TAYMER NAZORATI
setInterval(async () => {
    let now = Date.now();
    activeRooms.forEach(async (room, index) => {
        if (room.status === 'playing' && (now - room.lastActionTime > 20000)) {
            if (!room.p1Rolled && room.p2Rolled) {
                await handleTimeoutWin(room.player2, room.player1, room.betAmount);
            } else if (room.p1Rolled && !room.p2Rolled) {
                await handleTimeoutWin(room.player1, room.player2, room.betAmount);
            }
            activeRooms.splice(index, 1);
        }
    });
}, 2000);

async function handleTimeoutWin(winnerName, loserName, amount) {
    let isWinnerBot = winnerName.startsWith('Muxa');
    let uWin = isWinnerBot ? await Bot.findOne({ name: winnerName }) : await User.findOne({ username: winnerName });

    if (!uWin) return;

    if (isWinnerBot) {
        uWin.balance += (amount * 2);
    } else {
        let totalPrize = amount * 2;
        let tax = Math.floor(totalPrize * 0.02);
        uWin.balance += (totalPrize - tax);

        let bank = await Bank.findOne();
        bank.accumulatedTax += tax;
        await bank.save();
    }
    await uWin.save();
    await new History({ match: `${winnerName} vs ${loserName} (Timeout)`, amount, winner: winnerName }).save();
}

// 🕹️ API: MATCHMAKING
app.post('/api/matchmake', async (req, res) => {
    const { username, betAmount } = req.body;
    let isBot = username.startsWith('Muxa');
    let user = isBot ? await Bot.findOne({ name: username }) : await User.findOne({ username });

    if (!user || user.balance < betAmount) {
        return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
    }

    let room = activeRooms.find(r => r.betAmount === betAmount && r.status === 'waiting' && r.player1 !== username);

    if (room) {
        room.player2 = username;
        room.status = 'playing';
        room.lastActionTime = Date.now();
        user.balance -= betAmount;
        await user.save();
        return res.json({ success: true, room });
    } else {
        if (betAmount === 1200000) { // 1.2M xonada faqat odam odamni kutadi
            let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
            user.balance -= betAmount;
            await user.save();
            activeRooms.push(newRoom);
            return res.json({ success: true, room: newRoom });
        }

        // Boshqa xonalarda 3 soniyada Muxa botlaridan biri ulanadi
        let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
        user.balance -= betAmount;
        await user.save();
        
        setTimeout(async () => {
            let currentRoom = activeRooms.find(r => r.roomId === newRoom.roomId);
            if (currentRoom && !currentRoom.player2) {
                const bots = await Bot.find({});
                let randomBot = bots[Math.floor(Math.random() * bots.length)];
                currentRoom.player2 = randomBot.name;
                currentRoom.status = 'playing';
                currentRoom.lastActionTime = Date.now();
                randomBot.balance -= betAmount;
                await randomBot.save();
            }
        }, 3000);

        activeRooms.push(newRoom);
        return res.json({ success: true, room: newRoom });
    }
});

// 🎲 API: TOSH TASHLAH VA INTEGRATSIYALASHGAN FOIZ ALGORITMI
app.post('/api/roll-dice', async (req, res) => {
    const { roomId, username } = req.body;
    let room = activeRooms.find(r => r.roomId === parseInt(roomId));

    if (!room) return res.status(404).json({ success: false, message: "O'yin topilmadi" });

    let score = Math.floor(Math.random() * 6) + 1;

    if (room.player1 === username) { room.p1Score = score; room.p1Rolled = true; } 
    else if (room.player2 === username) { room.p2Score = score; room.p2Rolled = true; }

    room.lastActionTime = Date.now();

    if (room.p1Rolled && room.p2Rolled) {
        let p1IsBot = room.player1.startsWith('Muxa');
        let p2IsBot = room.player2.startsWith('Muxa');

        let p1User = p1IsBot ? await Bot.findOne({ name: room.player1 }) : await User.findOne({ username: room.player1 });
        let p2User = p2IsBot ? await Bot.findOne({ name: room.player2 }) : await User.findOne({ username: room.player2 });
        let bank = await Bank.findOne();

        // 🎯 MATEMATIK QAT'IY ALGORITM: 2 marta Bot yutadi, 1 marta Odam yutadi
        if (p2IsBot && !p1IsBot) { // player1 - Haqiqiy odam, player2 - Bot
            p1User.gameCounter += 1;
            if (p1User.gameCounter % 3 !== 0) { 
                room.p2Score = 6; room.p1Score = Math.floor(Math.random() * 5) + 1; 
            } else { 
                room.p1Score = 6; room.p2Score = Math.floor(Math.random() * 5) + 1; 
            }
            await p1User.save();
        } else if (p1IsBot && !p2IsBot) { // player2 - Haqiqiy odam, player1 - Bot
            p2User.gameCounter += 1;
            if (p2User.gameCounter % 3 !== 0) { 
                room.p1Score = 6; room.p2Score = Math.floor(Math.random() * 5) + 1; 
            } else { 
                room.p2Score = 6; room.p1Score = Math.floor(Math.random() * 5) + 1; 
            }
            await p2User.save();
        }

        let winner, loser, winnerIsBot;
        if (room.p1Score > room.p2Score) {
            winner = p1User; loser = p2User; winnerIsBot = p1IsBot;
        } else if (room.p2Score > room.p1Score) {
            winner = p2User; loser = p1User; winnerIsBot = p2IsBot;
        } else { // Durang bo'lsa
            p1User.balance += room.betAmount; p2User.balance += room.betAmount;
            await p1User.save(); await p2User.save();
            activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
            return res.json({ success: true, result: "Durang!", scores: { p1: room.p1Score, p2: room.p2Score } });
        }

        let totalPrize = room.betAmount * 2;
        
        if (!winnerIsBot) { // Odam yutganida 2% soliq olinadi va bazaga yoziladi
            let tax = Math.floor(totalPrize * 0.02);
            winner.balance += (totalPrize - tax);
            bank.accumulatedTax += tax;
        } else { // Bot yutsa soliq olinmaydi, pul unga to'liq o'tadi
            winner.balance += totalPrize;
        }

        await winner.save();
        await loser.save();
        await bank.save();

        await new History({ match: `${room.player1} vs ${room.player2}`, amount: room.betAmount, winner: winner.name || winner.username }).save();
        
        let finalResult = {
            success: true,
            result: `G'olib: ${room.p1Score > room.p2Score ? room.player1 : room.player2}`,
            scores: { p1: room.p1Score, p2: room.p2Score },
            myBalance: username === (room.p1Score > room.p2Score ? room.player1 : room.player2) ? winner.balance : loser.balance
        };

        activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
        return res.json(finalResult);
    }

    res.json({ success: true, waitingForOpponent: true });
});

// ADMIN PANEL APILAR
app.get('/api/users-list', async (req, res) => {
    const users = await User.find({});
    const bots = await Bot.find({});
    let bank = await Bank.findOne();
    const history = await History.find().sort({ time: -1 }).limit(10);
    res.json({ success: true, users, bots, bank, history });
});

app.post('/api/admin/change-balance', async (req, res) => {
    const { name, action, amount } = req.body;
    let isBot = name.startsWith('Muxa');
    let account = isBot ? await Bot.findOne({ name: name }) : await User.findOne({ username: name });
    
    if (!account) return res.status(404).json({ success: false });

    if (action === 'add') account.balance += amount;
    else if (action === 'remove') account.balance -= amount;

    await account.save();
    res.json({ success: true });
});

app.post('/api/admin/clear-tax', async (req, res) => {
    let bank = await Bank.findOne();
    if (bank && bank.accumulatedTax > 0) {
        bank.totalBalance += bank.accumulatedTax; // Yig'ilgan soliq 100 mlnlik bank kassa hisobiga qo'shiladi
        bank.accumulatedTax = 0;
        await bank.save();
        return res.json({ success: true, message: "Soliq muvaffaqiyatli Bank fondiga o'tkazildi!" });
    }
    res.json({ success: false, message: "O'tkazish uchun soliq yig'ilmagan!" });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log('Tizim muvaffaqiyatli sozlanti!'));
