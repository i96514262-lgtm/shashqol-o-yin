const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log('MongoDB muvaffaqiyatli ulandi!');
      await baziInitsializatsiya();
  })
  .catch(err => console.error('Baza ulanishida xatolik:', err));

// DB SCHEMAS
const UserSchema = new mongoose.Schema({ 
    username: String, 
    balance: { type: Number, default: 5000000 },
    botGameCounter: { type: Number, default: 0 } // Botga qarshi o'yinlar soni
});
const BotSchema = new mongoose.Schema({ name: String, balance: { type: Number, default: 20000000 } });
const BankSchema = new mongoose.Schema({ totalBalance: { type: Number, default: 100000000 }, accumulatedTax: { type: Number, default: 0 } });
const HistorySchema = new mongoose.Schema({ match: String, amount: Number, winner: String, time: { type: Date, default: Date.now } });

const User = mongoose.model('User', UserSchema);
const Bot = mongoose.model('Bot', BotSchema);
const Bank = mongoose.model('Bank', BankSchema);
const History = mongoose.model('History', HistorySchema);

let activeRooms = [];
let onlineUsersCount = 0;

function formatUZS(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " UZS";
}

async function baziInitsializatsiya() {
    await User.deleteMany({ username: { $regex: /bot|muxa/i } });
    await Bot.deleteMany({});
    const fixedBots = ['Muxa 1', 'Muxa 2', 'Muxa 3'];
    for (let botName of fixedBots) {
        await new Bot({ name: botName, balance: 20000000 }).save();
    }
    let bank = await Bank.findOne();
    if (!bank) await new Bank({ totalBalance: 100000000, accumulatedTax: 0 }).save();
}

// 700k va 1M xonalarida botlarning o'zaro o'yini (Kassa barqarorligi uchun)
setInterval(async () => {
    try {
        const bots = await Bot.find({});
        if (bots.length < 2) return;
        let b1 = bots[Math.floor(Math.random() * bots.length)];
        let b2 = bots[Math.floor(Math.random() * bots.length)];
        while (b1.name === b2.name) { b2 = bots[Math.floor(Math.random() * bots.length)]; }
        
        const botAmounts = [700000, 1000000];
        let bet = botAmounts[Math.floor(Math.random() * botAmounts.length)];
        
        b1.balance -= bet; b2.balance -= bet;
        let winner = Math.random() > 0.5 ? b1 : b2;
        winner.balance += (bet * 2);
        await b1.save(); await b2.save();
    } catch (e) { console.log("Bot-bot o'yin xatosi"); }
}, 6000);

// Real-time taymer (20 soniya)
setInterval(() => {
    activeRooms.forEach(async (room, index) => {
        if (room.status === 'playing') {
            room.timeLeft -= 1;
            io.to(room.roomId).emit('timer-update', { timeLeft: room.timeLeft });

            if (room.timeLeft <= 0) {
                let winnerName = room.player1;
                let loserName = room.player2;

                // Vaqt tugaganda bot bo'lsa har doim bot yutadi
                if (room.player2.startsWith('Muxa')) { winnerName = room.player2; loserName = room.player1; }
                else if (room.player1.startsWith('Muxa')) { winnerName = room.player1; loserName = room.player2; }

                await handleTimeoutWin(winnerName, loserName, room.betAmount, room.roomId);
                activeRooms.splice(index, 1);
            }
        }
    });
}, 1000);

async function handleTimeoutWin(wName, lName, amount, roomId) {
    let isWBot = wName.startsWith('Muxa');
    let winnerObj = isWBot ? await Bot.findOne({ name: wName }) : await User.findOne({ username: wName });
    if (!winnerObj) return;

    let totalPrize = amount * 2;
    if (!isWBot) {
        let tax = Math.floor(totalPrize * 0.02);
        winnerObj.balance += (totalPrize - tax);
    } else {
        winnerObj.balance += totalPrize;
    }
    await winnerObj.save();
    io.to(roomId).emit('game-finished', { result: `G'olib (Vaqt tugadi): ${wName}`, winner: wName });
}

io.on('connection', (socket) => {
    onlineUsersCount++;
    io.emit('online-count', { count: onlineUsersCount });
    socket.on('join-room', (roomId) => { socket.join(roomId); });
    socket.on('disconnect', () => { if (onlineUsersCount > 0) onlineUsersCount--; io.emit('online-count', { count: onlineUsersCount }); });
});

// API: MATCHMAKING
app.post('/api/matchmake', async (req, res) => {
    const { username, betAmount } = req.body;
    let user = await User.findOne({ username });

    if (!user || user.balance < betAmount) {
        return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
    }

    let room = activeRooms.find(r => r.betAmount === betAmount && r.status === 'waiting' && r.player1 !== username);

    if (room) {
        room.player2 = username;
        room.status = 'playing';
        room.timeLeft = 20;
        user.balance -= betAmount;
        await user.save();

        io.to(room.roomId).emit('match-started', { room });
        return res.json({ success: true, room });
    } else {
        let roomId = "room_" + Date.now();
        let newRoom = { roomId, betAmount, player1: username, player2: null, status: 'waiting', timeLeft: 20, p1Rolled: false, p2Rolled: false };
        
        user.balance -= betAmount;
        await user.save();
        activeRooms.push(newRoom);

        // 🎯 FAQAT 700 000 va 1 000 000 xonalariga bot kiradi. Qolgan xonalarda faqat odam odamni kutadi!
        if (betAmount === 700000 || betAmount === 1000000) { 
            setTimeout(async () => {
                let currentRoom = activeRooms.find(r => r.roomId === roomId);
                if (currentRoom && !currentRoom.player2) {
                    const bots = await Bot.find({});
                    let rBot = bots[Math.floor(Math.random() * bots.length)];
                    currentRoom.player2 = rBot.name;
                    currentRoom.status = 'playing';
                    rBot.balance -= betAmount;
                    await rBot.save();
                    io.to(roomId).emit('match-started', { room: currentRoom });
                }
            }, 2000);
        }
        return res.json({ success: true, room: newRoom });
    }
});

// API: DICE ROLL (80% BOT YUTISH ALGORITMI - 3 YUTIB, 1 YUTQAZISH)
app.post('/api/roll-dice', async (req, res) => {
    const { roomId, username } = req.body;
    let room = activeRooms.find(r => r.roomId === roomId);

    if (!room) return res.status(404).json({ success: false, message: "O'yin topilmadi" });

    if (room.player1 === username) { room.p1Rolled = true; } 
    else if (room.player2 === username) { room.p2Rolled = true; }

    if (room.player1.startsWith('Muxa')) room.p1Rolled = true;
    if (room.player2.startsWith('Muxa')) room.p2Rolled = true;

    if (room.p1Rolled && room.p2Rolled) {
        let p1Bot = room.player1.startsWith('Muxa');
        let p2Bot = room.player2.startsWith('Muxa');

        let p1User = p1Bot ? await Bot.findOne({ name: room.player1 }) : await User.findOne({ username: room.player1 });
        let p2User = p2Bot ? await Bot.findOne({ name: room.player2 }) : await User.findOne({ username: room.player2 });
        let bank = await Bank.findOne();

        // 🎯 ALGORITM: 80% BOT YUTADI (3 TA O'YIN BOT, 1 TA O'YIN ODAM)
        if (p1Bot && !p2Bot) { // p1 Bot, p2 Odam
            p2User.botGameCounter += 1;
            if (p2User.botGameCounter % 4 !== 0) { 
                room.p1Score = 6; room.p2Score = Math.floor(Math.random() * 5) + 1; // Bot yutadi
            } else { 
                room.p2Score = 6; room.p1Score = Math.floor(Math.random() * 5) + 1; // Odam yutadi
            }
            await p2User.save();
        } else if (p2Bot && !p1Bot) { // p2 Bot, p1 Odam
            p1User.botGameCounter += 1;
            if (p1User.botGameCounter % 4 !== 0) { 
                room.p2Score = 6; room.p1Score = Math.floor(Math.random() * 5) + 1; // Bot yutadi
            } else { 
                room.p1Score = 6; room.p2Score = Math.floor(Math.random() * 5) + 1; // Odam yutadi
            }
            await p1User.save();
        } else {
            // 40k, 100k, 300k, 1.2M xonalarda Odam va Odam halol o'ynaydi (Tasodifiy)
            room.p1Score = Math.floor(Math.random() * 6) + 1;
            room.p2Score = Math.floor(Math.random() * 6) + 1;
            if (room.p1Score === room.p2Score) room.p1Score = room.p1Score === 6 ? 5 : room.p1Score + 1; 
        }

        let winner, loser, wIsBot;
        if (room.p1Score > room.p2Score) { winner = p1User; loser = p2User; wIsBot = p1Bot; } 
        else { winner = p2User; loser = p1User; wIsBot = p2Bot; }

        let totalPrize = room.betAmount * 2;
        if (!wIsBot) {
            let tax = Math.floor(totalPrize * 0.02);
            winner.balance += (totalPrize - tax);
            bank.accumulatedTax += tax;
        } else {
            winner.balance += totalPrize;
        }

        await winner.save(); if(loser) await loser.save(); await bank.save();
        await new History({ match: `${room.player1} vs ${room.player2}`, amount: room.betAmount, winner: winner.name || winner.username }).save();

        io.to(room.roomId).emit('game-finished', { 
            result: `G'olib: ${room.p1Score > room.p2Score ? room.player1 : room.player2} (Ochko: ${room.p1Score} - ${room.p2Score})`,
            scores: { p1: room.p1Score, p2: room.p2Score } 
        });

        activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
        return res.json({ success: true });
    }

    io.to(room.roomId).emit('player-rolled', { username });
    res.json({ success: true });
});

app.get('/api/users-list', async (req, res) => {
    let users = await User.find({});
    let bots = await Bot.find({});
    res.json({ success: true, users: users, rawUsers: users.map(u => ({ username: u.username, balance: formatUZS(u.balance) })), rawBots: bots.map(b => ({ name: b.name, balance: formatUZS(b.balance) })) });
});

server.listen(process.env.PORT || 3000, () => console.log('Tizim 100% tayyor!'));
