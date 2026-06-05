const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DB_FILE = path.join(__dirname, 'database.json');

// Asosiy xotira (Ma'lumotlar vaqtincha shu yerda turadi)
let dbData = {
    players: {},
    nextPlayerId: 100000, 
    companyProfit: 0
};

// Fayldan o'qish
if (fs.existsSync(DB_FILE)) {
    try {
        dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.log("Baza o'qishda xato.");
    }
}

// Botlarni to'g'ridan-to'g'ri bazaga qo'shamiz
const BOT_ACCOUNTS = {
    "8881": { id: 8881, name: "🤖 Bot_Olim", password: "bot", balance: 5000000, status: "idle", isBot: true },
    "8882": { id: 8882, name: "🤖 Bot_Anvar", password: "bot", balance: 5000000, status: "idle", isBot: true },
    "8883": { id: 8883, name: "🤖 Bot_Temur", password: "bot", balance: 5000000, status: "idle", isBot: true }
};

for (let botId in BOT_ACCOUNTS) {
    if (!dbData.players[botId]) dbData.players[botId] = BOT_ACCOUNTS[botId];
}
saveToDatabase();

let onlineSockets = {}; 
let waitingLobby = []; 
let activeRooms = {};
const ADMIN_PASSWORD = "0613"; 
const OSHIQ_SIDES = ["Oʻng", "Chap", "Tik oʻng", "Tik chap"];

function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

// BOTLARNING ICHKI MANTIQ TIZIMI (Alohida bots.js kerak emas)
setInterval(() => {
    Object.values(dbData.players).forEach(p => {
        if (p.isBot && p.balance > 0 && (p.status === "idle" || p.status === "offline")) {
            // Botlar asosan 100,000 yoki 1,000,000 so'mlik xonalarda kutadi
            let botBet = Math.random() > 0.5 ? 1000000 : 100000;
            p.status = "searching";
            waitingLobby.push({ socketId: `internal_bot_${p.id}`, playerId: p.id, bet: botBet });
            broadcastAdminData();
            checkAndMatchGames();
        }
    });
}, 8000); // Har 8 soniyada botlar faolligini tekshirish

// QOLGAN BARCHA FUNKSIYALAR (Qidirish, Tashlash, Yutish mantig'i) 
// Sizning oldingi server.js kodingizdagi kabi qoladi. 
// Shunchaki botlar uchun socket.emit o'rniga ichki funksiyalarni chaqiramiz.

function checkAndMatchGames() {
    let bets = [50000, 100000, 300000, 700000, 1000000];
    bets.forEach(bet => {
        let candidates = waitingLobby.filter(w => w.bet === bet && dbData.players[w.playerId]?.status === "searching");
        if (candidates.length >= 2) {
            let p1Node = candidates[0];
            let p2Node = candidates[1];

            waitingLobby = waitingLobby.filter(w => w.playerId !== p1Node.playerId && w.playerId !== p2Node.playerId);

            const roomId = "room_" + Date.now();
            let p1Data = dbData.players[p1Node.playerId];
            let p2Data = dbData.players[p2Node.playerId];

            p1Data.status = "playing";
            p2Data.status = "playing";

            const timeoutId = setTimeout(() => { handleRoomTimeout(roomId); }, 20000);

            activeRooms[roomId] = {
                id: roomId,
                bet: bet,
                timeoutId: timeoutId,
                players: [
                    { socketId: p1Node.socketId, id: p1Data.id, name: p1Data.name, result: null, isBot: p1Data.isBot },
                    { socketId: p2Node.socketId, id: p2Data.id, name: p2Data.name, result: null, isBot: p2Data.isBot }
                ]
            };

            if(!p1Data.isBot) io.to(p1Node.socketId).emit('game_start', { roomId, bet, p1: p1Data.name, p2: p2Data.name });
            if(!p2Data.isBot) io.to(p2Node.socketId).emit('game_start', { roomId, bet, p1: p1Data.name, p2: p2Data.name });

            // Botlar avtomatik tosh tashlashi
            handleBotAutoRoll(roomId);
        }
    });
}

function handleBotAutoRoll(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;
    room.players.forEach(p => {
        if (p.isBot) {
            setTimeout(() => {
                if (activeRooms[roomId]) executeRollDice(p.socketId, roomId);
            }, Math.floor(Math.random() * 3000) + 2000);
        }
    });
}

// ... Qolgan evaluateOshiq, evaluateWinnerMatematika, io.on('connection') funksiyalarini bu yerga o'z holicha qo'shib qo'yasiz ...

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('Yangi optimizatsiya qilingan server yoqildi.'); });
