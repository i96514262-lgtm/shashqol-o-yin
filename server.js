const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let activeRooms = [];
let pendingBets = []; 
let adminBank = 100000000; 
let adminTaxProfit = 0; 
const ADMIN_SECRET_PIN = process.env.ADMIN_SECRET_PIN || "0613";

// MongoDB-ga xavfsiz ulanish
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("💡 MongoDB Atlas-ga muvaffaqiyatli ulanildi...");
        await botiarniTekshirish();
    })
    .catch((err) => console.error("❌ MongoDB ulanishida xatolik:", err));

// Tizim uchun botlarni bazada shakllantirish
async function botiarniTekshirish() {
    const bots = [
        { username: "Bot_Alisher", pin: "0000", balance: 15000000, isBot: true },
        { username: "Bot_Madina", pin: "0000", balance: 15000000, isBot: true },
        { username: "Bot_Jasur", pin: "0000", balance: 15000000, isBot: true }
    ];
    for (let bot of bots) {
        const mavjudBot = await User.findOne({ username: bot.username });
        if (!mavjudBot) {
            await User.create(bot);
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

io.on('connection', async (socket) => {
    await updateGlobalStats();

    // Avtorizatsiya va Ro'yxatdan o'tish tizimi
    socket.on('auth', async (data) => {
        const { username, pin } = data;
        if (!username || !pin) return socket.emit('auth_error', "Ma'lumotlarni to'liq kiriting!");

        try {
            let user = await User.findOne({ username: username });

            if (!user) {
                user = new User({ username, pin, balance: 300000, isBot: false });
                await user.save();
                socket.emit('auth_success', { username, balance: 300000, msg: "Xush kelibsiz! 300,000 so'm bonus berildi." });
            } else {
                if (user.pin === pin) {
                    socket.emit('auth_success', { username, balance: user.balance, msg: "Akkauntga qaytadingiz!" });
                } else {
                    socket.emit('auth_error', "Xato PIN-kod yoki ushbu ism band!");
                    return;
                }
            }
            socket.username = username;
            socket.userId = user._id;
            await updateGlobalStats();
        } catch (err) {
            socket.emit('auth_error', "Tizimda xatolik yuz berdi.");
        }
    });

    // Pul tikish va Raqib qidirish mantiqi
    socket.on('place_bet', async (amount) => {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return socket.emit('error_msg', "Noto'g'ri summa!");

        const user = await User.findOne({ username: socket.username });
        if (!user || user.balance < amount) {
            socket.emit('error_msg', "Mablag' yetarli emas!");
            return;
        }

        user.balance -= amount;
        await user.save();
        socket.emit('balance_update', user.balance);

        let opponent = pendingBets.find(b => b.amount === amount && b.username !== socket.username);

        if (opponent) {
            pendingBets = pendingBets.filter(b => b.socketId !== opponent.socketId);
            clearTimeout(opponent.timeoutId);
            startMatch(socket.username, socket.id, opponent.username, opponent.socketId, amount);
        } else {
            const timeoutId = setTimeout(async () => {
                pendingBets = pendingBets.filter(b => b.socketId !== socket.id);
                
                await User.updateOne({ username: socket.username }, { $inc: { balance: amount } });
                const yangiUser = await User.findOne({ username: socket.username });
                socket.emit('balance_update', yangiUser.balance);
                socket.emit('error_msg', "Raqib topilmadi. Pul qaytarildi.");
                
                if (amount === 700000 || amount === 1000000) {
                    activateBotMatch(socket.username, socket.id, amount);
                }
            }, 20000);

            pendingBets.push({ socketId: socket.id, username: socket.username, amount, timeoutId });
            socket.emit('waiting_match', `Raqib qidirilmoqda (${amount.toLocaleString()} so'm)...`);
        }
        await updateGlobalStats();
    });

    // Admin tizimi
    socket.on('admin_auth', (inputPin) => {
        if (inputPin === ADMIN_SECRET_PIN) {
            socket.isAdmin = true;
            sendAdminData();
        } else {
            socket.emit('admin_auth_failed', "Xato admin kodi!");
        }
    });

    socket.on('admin_action', async (data) => {
        if (!socket.isAdmin) return;
        const { targetUser, action, amount } = data;
        
        const user = await User.findOne({ username: targetUser });
        if (user) {
            if (action === 'add' && adminBank >= amount) {
                user.balance += amount;
                adminBank -= amount;
            } else if (action === 'withdraw' && user.balance >= amount) {
                user.balance -= amount;
                adminBank += amount; 
            }
            await user.save();

            const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === targetUser);
            if (targetSocket) targetSocket.emit('balance_update', user.balance);
            sendAdminData(); 
        }
    });

    socket.on('collect_tax_to_bank', () => {
        if (!socket.isAdmin) return;
        if (adminTaxProfit <= 0) return;
        adminBank += adminTaxProfit;
        adminTaxProfit = 0;
        sendAdminData(); 
    });

    socket.on('disconnect', async () => {
        pendingBets = pendingBets.filter(b => b.socketId !== socket.id);
        await updateGlobalStats();
    });
});

// Real O'yinchilar o'rtasidagi o'yin
async function startMatch(p1Name, p1Socket, p2Name, p2Socket, amount) {
    const totalPrize = amount * 2;
    const tax = totalPrize * 0.02; 
    const winAmount = totalPrize - tax;
    adminTaxProfit += tax; 

    const p1Roll = Math.floor(Math.random() * 4); 
    const p2Roll = Math.floor(Math.random() * 4);

    let winnerName = p1Name;
    let winnerSocket = p1Socket;
    let r1 = "Alchi 👑", r2 = "Bok ❌";

    if (p2Roll > p1Roll) { 
        winnerName = p2Name; winnerSocket = p2Socket;
        r1 = "Bok ❌"; r2 = "Alchi 👑";
    } else if (p1Roll === p2Roll) {
        await User.updateOne({ username: p1Name }, { $inc: { balance: amount } });
        await User.updateOne({ username: p2Name }, { $inc: { balance: amount } });
        
        const u1 = await User.findOne({ username: p1Name });
        const u2 = await User.findOne({ username: p2Name });

        if(io.sockets.sockets.get(p1Socket)) io.to(p1Socket).emit('match_result', { win: false, roll: "Durang 🤝", oppRoll: "Durang 🤝", prize: 0, balance: u1.balance });
        if(io.sockets.sockets.get(p2Socket)) io.to(p2Socket).emit('match_result', { win: false, roll: "Durang 🤝", oppRoll: "Durang 🤝", prize: 0, balance: u2.balance });
        return;
    }

    await User.updateOne({ username: winnerName }, { $inc: { balance: winAmount } });
    
    const u1 = await User.findOne({ username: p1Name });
    const u2 = await User.findOne({ username: p2Name });

    if(io.sockets.sockets.get(p1Socket)) io.to(p1Socket).emit('match_result', { win: winnerName === p1Name, roll: r1, oppRoll: r2, prize: winAmount, balance: u1.balance });
    if(io.sockets.sockets.get(p2Socket)) io.to(p2Socket).emit('match_result', { win: winnerName === p2Name, roll: r2, oppRoll: r1, prize: winAmount, balance: u2.balance });

    activeRooms.push({ p1: p1Name, p2: p2Name, amount: amount, winner: winnerName });
    if (activeRooms.length > 8) activeRooms.shift(); 
    sendAdminData();
}

// Bot bilan o'yin mantiqi
async function activateBotMatch(humanName, humanSocket, amount) {
    const bots = await User.find({ isBot: true });
    if(bots.length === 0) return;
    const selectedBot = bots[Math.floor(Math.random() * bots.length)];
    
    const totalPrize = amount * 2;
    const tax = totalPrize * 0.02;
    const winAmount = totalPrize - tax;
    adminTaxProfit += tax;

    let humanWins = Math.random() > 0.5;

    if (humanWins) {
        await User.updateOne({ username: humanName }, { $inc: { balance: winAmount } });
        const hUser = await User.findOne({ username: humanName });
        io.to(humanSocket).emit('match_result', { win: true, roll: "Alchi 👑", oppRoll: "Bok ❌", prize: winAmount, balance: hUser.balance });
    } else {
        await User.updateOne({ username: selectedBot.username }, { $inc: { balance: winAmount } });
        const hUser = await User.findOne({ username: humanName });
        io.to(humanSocket).emit('match_result', { win: false, roll: "Tova 🛡️", oppRoll: "Alchi 👑", prize: 0, balance: hUser.balance });
    }

    activeRooms.push({ p1: humanName, p2: selectedBot.username, amount: amount, winner: humanWins ? humanName : selectedBot.username });
    if (activeRooms.length > 8) activeRooms.shift();
    sendAdminData();
}

async function updateGlobalStats() {
    let onlineCount = io.sockets.sockets.size + 3; 
    io.emit('global_stats', { onlineCount, pendingCount: pendingBets.length });
}

async function sendAdminData() {
    const barchaOynchilar = await User.find({});
    io.sockets.sockets.forEach(s => {
        if (s.isAdmin) {
            s.emit('admin_update', {
                adminBank,
                adminTaxProfit,
                users: barchaOynchilar.map(u => ({ username: u.username, balance: u.balance, isBot: u.isBot })),
                activeRooms
            });
        }
    });
}

server.listen(PORT, () => console.log(`🚀 Server ${PORT}-portda muvaffaqiyatli ishlamoqda...`));
