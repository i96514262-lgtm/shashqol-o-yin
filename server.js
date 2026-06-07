const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Baza muvaffaqiyatli ulandi!'))
  .catch(err => console.error(err));

// Ma'lumotlar sxemalari
const UserSchema = new mongoose.Schema({ username: String, balance: {type: Number, default: 5000000}, gameCounter: {type: Number, default: 0}, status: {type: String, default: 'idle'} });
const BotSchema = new mongoose.Schema({ name: String, balance: {type: Number, default: 20000000} });
const BankSchema = new mongoose.Schema({ totalBalance: Number, accumulatedTax: Number });
const HistorySchema = new mongoose.Schema({ match: String, amount: Number, winner: String, time: { type: Date, default: Date.now } });

const User = mongoose.model('User', UserSchema);
const Bot = mongoose.model('Bot', BotSchema);
const Bank = mongoose.model('Bank', BankSchema);
const History = mongoose.model('History', HistorySchema);

// Aktiv o'yin xonalari tizimi (Xotirada tezkor ishlash uchun)
let activeRooms = [];

// BOTLARNING 24/7 O'ZARO O'YINI (Har 4 soniyada avtomatik o'yin)
setInterval(async () => {
    try {
        const bots = await Bot.find({});
        if(bots.length < 2) return;

        // Tasodifiy 2 ta botni tanlash
        let b1 = bots[Math.floor(Math.random() * bots.length)];
        let b2 = bots[Math.floor(Math.random() * bots.length)];
        while(b1.name === b2.name) { b2 = bots[Math.floor(Math.random() * bots.length)]; }

        const amounts = [40000, 100000, 300000, 700000, 1000000];
        let randomAmount = amounts[Math.floor(Math.random() * amounts.length)];

        if(b1.balance >= randomAmount && b2.balance >= randomAmount) {
            b1.balance -= randomAmount;
            b2.balance -= randomAmount;

            let winner = Math.random() > 0.5 ? b1 : b2;
            let loser = winner.name === b1.name ? b2 : b1;
            
            winner.balance += (randomAmount * 2); // Bot o'zaro o'ynaganda soliq olinmaydi
            
            await b1.save();
            await b2.save();

            await new History({ match: `${b1.name} vs ${b2.name}`, amount: randomAmount, winner: winner.name }).save();
        }
    } catch (e) { console.log("Botlar o'yinida xatolik"); }
}, 4000);

// AKTIV TAYMER NAZORATI (20 soniya ichida tosh tashlanmasa avtomatik raqib almashtirish)
setInterval(async () => {
    let now = Date.now();
    activeRooms.forEach(async (room, index) => {
        if (room.status === 'playing' && (now - room.lastActionTime > 20000)) {
            // Kim tosh tashlamagan bo'lsa, o'sha o'yindan chetlatiladi va yangi raqib qidiriladi
            if (!room.p1Rolled && room.p2Rolled) {
                // p1 tosh tashlamadi, demak p2 avtomatik yutadi
                await handleTimeoutWin(room.player2, room.player1, room.betAmount);
            } else if (room.p1Rolled && !room.p2Rolled) {
                // p2 tosh tashlamadi, p1 yutadi
                await handleTimeoutWin(room.player1, room.player2, room.betAmount);
            }
            activeRooms.splice(index, 1);
        }
    });
}, 2000);

async function handleTimeoutWin(winnerName, loserName, amount) {
    let uWin = await User.findOne({ username: winnerName }) || await Bot.findOne({ name: winnerName });
    uWin.balance += (amount * 1.98);
    await uWin.save();
    await new History({ match: `${winnerName} vs ${loserName} (Taymaout)`, amount, winner: winnerName }).save();
}

// API: Garov tikish va Real vaqtda Matchmaking
app.post('/api/matchmake', async (req, res) => {
    const { username, betAmount } = req.body;
    const user = await User.findOne({ username });

    if (!user || user.balance < betAmount) {
        return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
    }

    // Xona qidirish
    let room = activeRooms.find(r => r.betAmount === betAmount && r.status === 'waiting' && r.player1 !== username);

    if (room) {
        // Raqib topildi
        room.player2 = username;
        room.status = 'playing';
        room.lastActionTime = Date.now();
        user.balance -= betAmount;
        await user.save();
        return res.json({ success: true, room, message: "Raqib topildi! Tosh tashlang." });
    } else {
        // Agar 1.2M xona bo'lsa BOT ARALASHMAYDI, faqat odam kutadi
        if (betAmount === 1200000) {
            let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
            user.balance -= betAmount;
            await user.save();
            activeRooms.push(newRoom);
            return res.json({ success: true, room: newRoom, message: "Raqib kutilmoqda..." });
        }

        // Agar 700k yoki 1M bo'lsa va odam topilmasa, 3 soniyadan keyin BOT qo'shiladi
        if (betAmount === 700000 || betAmount === 1000000) {
            let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
            user.balance -= betAmount;
            await user.save();
            
            // Botni ulash simulyatsiyasi
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

        // Qolgan xonalarda odamlar o'zaro tasodifiy o'ynaydi
        let newRoom = { roomId: Date.now(), betAmount, player1: username, player2: null, status: 'waiting', lastActionTime: Date.now(), p1Rolled: false, p2Rolled: false };
        user.balance -= betAmount;
        await user.save();
        activeRooms.push(newRoom);
        return res.json({ success: true, room: newRoom, message: "Odamlar xonasi. Raqib kutilmoqda..." });
    }
});

// API: Tosh tashlash (Roll Dice)
app.post('/api/roll-dice', async (req, res) => {
    const { roomId, username } = req.body;
    let room = activeRooms.find(r => r.roomId === parseInt(roomId));

    if (!room) return res.status(404).json({ success: false, message: "O'yin topilmadi yoki vaqti tugadi!" });

    let score = Math.floor(Math.random() * 6) + 1;

    if (room.player1 === username) {
        room.p1Score = score;
        room.p1Rolled = true;
    } else if (room.player2 === username) {
        room.p2Score = score;
        room.p2Rolled = true;
    }

    room.lastActionTime = Date.now();

    // Har ikkala taraf ham tosh tashlagan bo'lsa natijani hisoblash
    if (room.p1Rolled && room.p2Rolled) {
        let p1User = await User.findOne({ username: room.player1 }) || await Bot.findOne({ name: room.player1 });
        let p2User = await User.findOne({ username: room.player2 }) || await Bot.findOne({ name: room.player2 });
        let bank = await Bank.findOne() || new Bank({ totalBalance: 100000000, accumulatedTax: 0 });

        // Algoritm: Agar odam botga qarshi o'ynasa (700k va 1M da 2 marta bot yutsin, 1 marta odam)
        if (room.player2.startsWith('Bot_') && !room.player1.startsWith('Bot_')) {
            p1User.gameCounter += 1;
            if (p1User.gameCounter % 3 !== 0) {
                // Bot yutishi shart
                room.p2Score = 6;
                room.p1Score = Math.floor(Math.random() * 5) + 1;
            } else {
                // Odam yutishi shart
                room.p1Score = 6;
                room.p2Score = Math.floor(Math.random() * 5) + 1;
            }
            await p1User.save();
        }

        let winner, loser, winScore, loseScore;
        if (room.p1Score > room.p2Score) {
            winner = p1User; loser = p2User; winScore = room.p1Score; loseScore = room.p2Score;
        } else if (room.p2Score > room.p1Score) {
            winner = p2User; loser = p1User; winScore = room.p2Score; loseScore = room.p1Score;
        } else {
            // Durang bo'lsa pullar qaytadi
            p1User.balance += room.betAmount;
            p2User.balance += room.betAmount;
            await p1User.save(); await p2User.save();
            activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
            return res.json({ success: true, result: "Durang! Mablag' qaytarildi.", scores: { p1: room.p1Score, p2: room.p2Score } });
        }

        // Xisoblash tizimi va 2% Soliq
        let totalPrize = room.betAmount * 2;
        let tax = Math.floor(totalPrize * 0.02);
        let netWin = totalPrize - tax;

        winner.balance += netWin;
        bank.accumulatedTax += tax;

        // Agar yutqazgan bot bo'lsa, uning puli xuddi odamniki kabi kamayib saqlanadi
        await winner.save();
        await loser.save();
        await bank.save();

        await new History({ match: `${p1User.username || p1User.name} vs ${p2User.username || p2User.name}`, amount: room.betAmount, winner: winner.username || winner.name }).save();
        
        let finalResult = {
            success: true,
            result: `G'olib: ${winner.username || winner.name}`,
            scores: { p1: room.p1Score, p2: room.p2Score },
            myBalance: username === winner.username ? winner.balance : loser.balance
        };

        activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
        return res.json(finalResult);
    }

    res.json({ success: true, waitingForOpponent: true, message: "Siz tosh tashladingiz. Raqib kutilmoqda..." });
});

// Admin uchun API qismlari
app.get('/api/users-list', async (req, res) => {
    const users = await User.find({});
    const bots = await Bot.find({});
    const bank = await Bank.findOne() || { totalBalance: 100000000, accumulatedTax: 0 };
    const history = await History.find().sort({ time: -1 }).limit(10);
    res.json({ success: true, users, bots, bank, history });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(process.env.PORT || 3000);
