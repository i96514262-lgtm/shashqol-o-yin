const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Ma'lumotlar bazasiga ulanish
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB muvaffaqiyatli ulandi!'))
  .catch(err => console.error('Baza ulanishida xatolik:', err));

// Ma'lumotlar sxemalari (Sxemalar)
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

// Aktiv o'yin xonalari ro'yxati (Tezkor operativ xotirada saqlanadi)
let activeRooms = [];

// 🤖 BOTLARNING 24/7 O'ZARO O'YINI (BOTLARDAN SOLIQ OLINMAYDI ❌)
setInterval(async () => {
    try {
        const bots = await Bot.find({});
        if (bots.length < 2) return;

        // Tasodifiy 2 ta botni tanlash
        let b1 = bots[Math.floor(Math.random() * bots.length)];
        let b2 = bots[Math.floor(Math.random() * bots.length)];
        while (b1.name === b2.name) { 
            b2 = bots[Math.floor(Math.random() * bots.length)]; 
        }

        const amounts = [40000, 100000, 300000, 700000, 1000000];
        let randomAmount = amounts[Math.floor(Math.random() * amounts.length)];

        if (b1.balance >= randomAmount && b2.balance >= randomAmount) {
            b1.balance -= randomAmount;
            b2.balance -= randomAmount;

            let winner = Math.random() > 0.5 ? b1 : b2;
            let loser = winner.name === b1.name ? b2 : b1;
            
            // Bot bot bilan o'ynaganda 100% yutuq qaytadi (Soliqsiz)
            winner.balance += (randomAmount * 2);
            
            await b1.save();
            await b2.save();

            await new History({ match: `${b1.name} vs ${b2.name}`, amount: randomAmount, winner: winner.name }).save();
        }
    } catch (e) { console.log("Botlar o'zaro o'yinida xatolik yuz berdi."); }
}, 4000);

// ⏳ 20 SONIYALIK TAYMER NAZORATI (Tosh tashlanmasa raqibni g'olib qilish)
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
    let uWin = await User.findOne({ username: winnerName });
    let isBot = false;
    
    if (!uWin) {
        uWin = await Bot.findOne({ name: winnerName });
        isBot = true;
    }

    if (isBot) {
        uWin.balance += (amount * 2);
    } else {
        let totalPrize = amount * 2;
        let tax = Math.floor(totalPrize * 0.02);
        uWin.balance += (totalPrize - tax);

        let bank = await Bank.findOne() || new Bank();
        bank.accumulatedTax += tax;
        await bank.save();
    }
    await uWin.save();
    await new History({ match: `${winnerName} vs ${loserName} (Timeout)`, amount, winner: winnerName }).save();
}

// 🕹️ API: Matchmaking (Garov tikish va Xona topish)
app.post('/api/matchmake', async (req, res) => {
    const { username, betAmount } = req.body;
    const user = await User.findOne({ username });

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
        return res.json({ success: true, room, message: "Raqib topildi! Tosh tashlang." });
    } else {
        // YASHIRIN MANTIQ: 1,200,000 xonasiga bot qo'shilmaydi, faqat odam kutadi!
        if (betAmount === 1200000) {
            let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
            user.balance -= betAmount;
            await user.save();
            activeRooms.push(newRoom);
            return res.json({ success: true, room: newRoom, message: "Raqib kutilmoqda..." });
        }

        // 700k va 1M xonalarida odam bo'lmasa 3 soniyada bot ulanadi
        if (betAmount === 700000 || betAmount === 1000000) {
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
            return res.json({ success: true, room: newRoom, message: "Raqib qidirilmoqda..." });
        }

        // Qolgan xonalar (40k, 100k, 300k) oddiy tartibda
        let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
        user.balance -= betAmount;
        await user.save();
        activeRooms.push(newRoom);
        return res.json({ success: true, room: newRoom, message: "Raqib kutilmoqda..." });
    }
});

// 🎲 API: Tosh tashlash va Soliq Hisoblash algoritmi
app.post('/api/roll-dice', async (req, res) => {
    const { roomId, username } = req.body;
    let room = activeRooms.find(r => r.roomId === parseInt(roomId));

    if (!room) return res.status(404).json({ success: false, message: "O'yin xonasi topilmadi!" });

    let score = Math.floor(Math.random() * 6) + 1;

    if (room.player1 === username) { room.p1Score = score; room.p1Rolled = true; } 
    else if (room.player2 === username) { room.p2Score = score; room.p2Rolled = true; }

    room.lastActionTime = Date.now();

    if (room.p1Rolled && room.p2Rolled) {
        let p1IsBot = room.player1.startsWith('Bot_');
        let p2IsBot = room.player2.startsWith('Bot_');

        let p1User = p1IsBot ? await Bot.findOne({ name: room.player1 }) : await User.findOne({ username: room.player1 });
        let p2User = p2IsBot ? await Bot.findOne({ name: room.player2 }) : await User.findOne({ username: room.player2 });
        let bank = await Bank.findOne() || new Bank();

        // 🎯 ALGORITM: Agar odam botga qarshi o'ynasa (2 marta bot yutadi, 1 marta odam)
        if (p2IsBot && !p1IsBot) {
            p1User.gameCounter += 1;
            if (p1User.gameCounter % 3 !== 0) { 
                room.p2Score = 6; 
                room.p1Score = Math.floor(Math.random() * 5) + 1; 
            } else { 
                room.p1Score = 6; 
                room.p2Score = Math.floor(Math.random() * 5) + 1; 
            }
            await p1User.save();
        }

        let winner, loser, winnerIsBot;
        if (room.p1Score > room.p2Score) {
            winner = p1User; loser = p2User; winnerIsBot = p1IsBot;
        } else if (room.p2Score > room.p1Score) {
            winner = p2User; loser = p1User; winnerIsBot = p2IsBot;
        } else {
            p1User.balance += room.betAmount; p2User.balance += room.betAmount;
            await p1User.save(); await p2User.save();
            activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
            return res.json({ success: true, result: "Durang! Tikilgan mablag' qaytarildi.", scores: { p1: room.p1Score, p2: room.p2Score } });
        }

        let totalPrize = room.betAmount * 2;
        
        // 💎 SOLIQNI FAQAT ODAMLARDAN OLISH TIZIMI
        if (!winnerIsBot) { 
            let tax = Math.floor(totalPrize * 0.02);
            winner.balance += (totalPrize - tax);
            bank.accumulatedTax += tax; // Soliq hisoblagichiga qo'shiladi
        } else {
            winner.balance += totalPrize; // Bot yutsa soliq olinmaydi
        }

        await winner.save();
        await loser.save();
        await bank.save();

        await new History({ match: `${room.player1} vs ${room.player2}`, amount: room.betAmount, winner: room.p1Score > room.p2Score ? room.player1 : room.player2 }).save();
        
        let finalResult = {
            success: true,
            result: `G'olib: ${room.p1Score > room.p2Score ? room.player1 : room.player2}`,
            scores: { p1: room.p1Score, p2: room.p2Score },
            myBalance: username === (room.p1Score > room.p2Score ? room.player1 : room.player2) ? winner.balance : loser.balance
        };

        activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
        return res.json(finalResult);
    }

    res.json({ success: true, waitingForOpponent: true, message: "Tosh tashlandi. Raqib kutilmoqda..." });
});

// 📊 API: Admin Dashboard Ma'lumotlari
app.get('/api/users-list', async (req, res) => {
    const users = await User.find({});
    const bots = await Bot.find({});
    let bank = await Bank.findOne() || new Bank();
    const history = await History.find().sort({ time: -1 }).limit(10);
    res.json({ success: true, users, bots, bank, history });
});

// 💰 API: Admin kassa (Pul qo'shish va o'chirish)
app.post('/api/admin/change-balance', async (req, res) => {
    try {
        const { name, action, amount } = req.body;
        let account = await User.findOne({ username: name }) || await Bot.findOne({ name: name });
        if (!account) return res.status(404).json({ success: false, message: "Foydalanuvchi yoki bot topilmadi!" });

        if (action === 'add') account.balance += amount;
        else if (action === 'remove') account.balance -= amount;

        await account.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 🏛️ API: Soliqni 100 mlnlik Bank hisobiga o'tkazish tugmasi
app.post('/api/admin/clear-tax', async (req, res) => {
    try {
        let bank = await Bank.findOne() || new Bank();
        if (bank.accumulatedTax > 0) {
            bank.totalBalance += bank.accumulatedTax; // 100 mln ustiga qo'shiladi
            bank.accumulatedTax = 0;                  // Soliq nollanadi
            await bank.save();
            return res.json({ success: true, message: "Soliq muvaffaqiyatli Bank fondiga o'tkazildi!" });
        } else {
            return res.json({ success: false, message: "O'tkazish uchun soliq yig'ilmagan!" });
        }
    } catch(e) { res.status(500).json({ success: false }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server yoqildi!'));
