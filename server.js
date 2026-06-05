const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DB_FILE = path.join(__dirname, 'database.json');

let dbData = {
    players: {},
    nextPlayerId: 100000, 
    companyProfit: 0
};

// 🤖 Tizim ishga tushganda bazani tekshirish va botlarni yaratish
if (fs.existsSync(DB_FILE)) {
    try {
        dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.log("Baza o'qishda xato.");
    }
}

// Botlarni xuddi haqiqiy odamdek ID bilan bazaga kiritish (parollari bilan)
const DEFAULT_BOTS = {
    "100001": { id: 100001, name: "Anvar", password: "bot1", balance: 0, status: "offline", isBot: true },
    "100002": { id: 100002, name: "Olim", password: "bot2", balance: 0, status: "offline", isBot: true }
};

for (let botId in DEFAULT_BOTS) {
    if (!dbData.players[botId]) {
        dbData.players[botId] = DEFAULT_BOTS[botId];
    } else {
        // Agar baza mavjud bo'lsa, ularni bot ekanligini belgilab qo'yamiz
        dbData.players[botId].isBot = true;
    }
}
if(dbData.nextPlayerId <= 100002) {
    dbData.nextPlayerId = 100003;
}

saveToDatabase();

function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

let onlineSockets = {}; 
let waitingLobby = []; 
let activeRooms = {};

const ADMIN_PASSWORD = "0613"; 
const OSHIQ_SIDES = ["Oʻng", "Chap", "Tik oʻng", "Tik chap"];

function getAdminPlayersList() {
    return Object.values(dbData.players).map(p => {
        let isOnline = Object.values(onlineSockets).includes(p.id) || p.status === "searching" || p.status === "playing";
        return {
            id: p.id,
            name: p.name,
            balance: p.balance,
            status: isOnline ? (p.status || "idle") : "offline"
        };
    });
}

function getActiveGamesList() {
    return Object.values(activeRooms).map(r => ({
        roomId: r.id,
        bet: r.bet,
        p1: r.players[0].name,
        p2: r.players[1].name
    }));
}

function broadcastAdminData() {
    io.to('admin_room').emit('admin_players_update', {
        players: getAdminPlayersList(),
        activeGames: getActiveGamesList()
    });
}

function broadcastOnlineCount() {
    // Oflyayn bo'lmagan jami foydalanuvchilar soni
    let count = Object.values(dbData.players).filter(p => p.status && p.status !== "offline").length;
    io.emit('online_count', count);
}

// 🤖 BOTLARNING AVTOMATIK FIKRLASH TIZIMI (24 SOAT UYQUSIZ)
setInterval(() => {
    Object.values(dbData.players).forEach(p => {
        if (p.isBot) {
            // Agar botning pulini admin to'ldirgan bo'lsa va u bo'sh o'tirgan bo'lsa
            if (p.balance >= 1000000 && (!p.status || p.status === "offline" || p.status === "idle")) {
                p.status = "searching";
                waitingLobby.push({ socketId: `bot_socket_${p.id}`, playerId: p.id, bet: 1000000 });
                broadcastAdminData();
                broadcastOnlineCount();
                
                // Kimdir kutayotgan bo'lsa, zudlik bilan xona ochishga buyruq beramiz
                checkAndMatchGames();
            }
        }
    });
}, 5000);

function checkAndMatchGames() {
    // Tikish summalari bo'yicha guruhlash
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

            io.to(p1Node.socketId).emit('game_start', { roomId: roomId, bet: bet, p1: p1Data.name, p2: p2Data.name });
            io.to(p2Node.socketId).emit('game_start', { roomId: roomId, bet: bet, p1: p1Data.name, p2: p2Data.name });
            io.to(roomId).emit('game_start', { roomId: roomId, bet: bet, p1: p1Data.name, p2: p2Data.name });

            broadcastAdminData();

            // Agar xonada bot bo'lsa, u 3-4 soniyada avtomat tosh tashlaydi
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
                if (activeRooms[roomId]) {
                    executeRollDice(p.socketId, roomId);
                }
            }, Math.floor(Math.random() * 3000) + 2000);
        }
    });
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

io.on('connection', (socket) => {
    broadcastOnlineCount();

    socket.on('admin_login', (pass) => {
        if(pass === ADMIN_PASSWORD) {
            socket.emit('admin_auth_success', {
                profit: dbData.companyProfit,
                players: getAdminPlayersList(),
                activeGames: getActiveGamesList()
            });
            socket.join('admin_room');
        } else {
            socket.emit('error_msg', 'Xato admin parol!');
        }
    });

    socket.on('admin_modify_balance', (data) => {
        const player = dbData.players[data.id];
        if (!player) return;
        if (data.type === 'plus') player.balance += data.amount;
        if (data.type === 'minus') {
            player.balance -= data.amount;
            if(player.balance < 0) player.balance = 0;
        }
        saveToDatabase();
        
        io.to(socket.id).emit('balance_updated', player.balance);
        for (let sId in onlineSockets) {
            if (onlineSockets[sId] === parseInt(data.id)) {
                io.to(sId).emit('balance_updated', player.balance);
            }
        }
        broadcastAdminData();
    });

    socket.on('register_player', (data) => {
        let player;
        if (data.id) {
            player = dbData.players[data.id];
            if (!player) return socket.emit('error_msg', 'Bunday ID topilmadi!');
            if (player.password !== data.password) return socket.emit('error_msg', 'Xato parol!');
        } else {
            if (!data.name || data.name.trim() === "") return socket.emit('error_msg', 'Ism kiriting!');
            if (!data.password || data.password.length !== 4) return socket.emit('error_msg', 'Parol 4 xonali boʻlsin!');

            let newId = dbData.nextPlayerId++;
            player = {
                id: newId,
                name: data.name,
                password: data.password, 
                balance: 0,
                status: "idle"
            };
            dbData.players[newId] = player;
            saveToDatabase();
        }

        onlineSockets[socket.id] = player.id;
        player.status = "idle";

        socket.emit('register_success', { id: player.id, name: player.name, balance: player.balance });
        broadcastOnlineCount();
        broadcastAdminData();
    });

    socket.on('find_opponent', (betAmount) => {
        const pId = onlineSockets[socket.id];
        const player = dbData.players[pId];
        if (!player) return;

        const bet = parseInt(betAmount);
        const ALLOWED_BETS = [50000, 100000, 300000, 700000, 1000000];
        if (!ALLOWED_BETS.includes(bet)) return socket.emit('error_msg', 'Xato tikish summasi!');
        if (player.balance < bet) return socket.emit('error_msg', 'Mablagʻ yetarli emas!');

        player.status = "searching";
        waitingLobby.push({ socketId: socket.id, playerId: player.id, bet: bet });
        broadcastAdminData();
        checkAndMatchGames();
    });

    socket.on('roll_dice', (roomId) => {
        executeRollDice(socket.id, roomId);
    });

    socket.on('disconnect', () => {
        const pId = onlineSockets[socket.id];
        waitingLobby = waitingLobby.filter(w => w.socketId !== socket.id);
        
        for (let rId in activeRooms) {
            if (activeRooms[rId].players.some(p => p.socketId === socket.id)) {
                clearTimeout(activeRooms[rId].timeoutId);
                handleRoomTimeout(rId);
            }
        }

        delete onlineSockets[socket.id];
        if(pId && dbData.players[pId] && !dbData.players[pId].isBot) {
            dbData.players[pId].status = "offline";
        }
        broadcastOnlineCount();
        broadcastAdminData();
    });
});

function executeRollDice(socketId, roomId) {
    const room = activeRooms[roomId];
    if (!room) return;
    const pIndex = room.players.findIndex(p => p.socketId === socketId);
    if (pIndex === -1 || room.players[pIndex].result !== null) return;

    let rolledSides = [];
    for (let i = 0; i < 4; i++) rolledSides.push(OSHIQ_SIDES[Math.floor(Math.random() * 4)]);
    
    // 🔥 ALGORITM: Oddiy holatda ochkoni hisoblash
    let evaluation = evaluateOshiq(rolledSides);
    room.players[pIndex].result = { score: evaluation.score, statusName: evaluation.statusName, isChu: evaluation.isChu };

    // Agar ikkala o'yinchi ham tosh tashlagan bo'lsa, g'olibni aniqlash
    if (room.players[0].result !== null && room.players[1].result !== null) {
        clearTimeout(room.timeoutId);
        evaluateWinnerMatematika(room);
    } else {
        io.to(roomId).emit('opponent_rolled');
    }
}

function handleRoomTimeout(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    io.to(roomId).emit('game_timeout', 'Oʻyin vaqti tugadi! Qayta qidirilmoqda...');

    room.players.forEach(p => {
        let pData = dbData.players[p.id];
        if (pData) pData.status = "idle";
        
        if (!p.isBot) {
            let clientSocket = io.sockets.sockets.get(p.socketId);
            if (clientSocket) {
                clientSocket.leave(roomId);
                clientSocket.emit('auto_reseek', room.bet);
            }
        }
    });

    delete activeRooms[roomId];
    broadcastAdminData();
}

function evaluateOshiq(sides) {
    let counts = { "Oʻng": 0, "Chap": 0, "Tik oʻng": 0, "Tik chap": 0 };
    sides.forEach(s => counts[s] = (counts[s] || 0) + 1);
    let uniqueCount = Object.keys(counts).filter(k => counts[k] > 0).length;
    let maxSame = Math.max(...Object.values(counts));
    let tikkaSoni = counts["Tik oʻng"] + counts["Tik chap"];

    if (uniqueCount === 4) return { score: 100, statusName: "SIYO", isChu: false };
    if (tikkaSoni === 4) return { score: 90, statusName: "4 URUGʻ", isChu: false };
    if (tikkaSoni === 3) return { score: 80, statusName: "3 URUGʻ", isChu: false };
    if (maxSame === 3) return { score: 0, statusName: "CHŪ", isChu: true };

    let normalScore = (counts["Tik oʻng"] * 4) + (counts["Tik chap"] * 3) + (counts["Oʻng"] * 2) + (counts["Chap"] * 1);
    return { score: normalScore, statusName: "POZA", isChu: false };
}

// 🧠 BOTLARNING YUTISH MATEMATIKASI (4 MARTA YUTIB, 1 MARTA YUTQAZISH)
function evaluateWinnerMatematika(room) {
    let p1 = room.players[0];
    let p2 = room.players[1];
    const bet = room.bet;
    let totalPool = bet * 2;
    let tax = Math.round(totalPool * 0.03);
    let netPrize = totalPool - tax;

    let p1Data = dbData.players[p1.id];
    let p2Data = dbData.players[p2.id];
    
    let winnerId = null;

    if (p1.isBot && p2.isBot) {
        // 🤖 Bot VS Bot bo'lsa: 50% ga 50% tasodifiy g'olib
        winnerId = Math.random() < 0.5 ? p1.id : p2.id;
    } else if (p1.isBot || p2.isBot) {
        // 👤 Odam VS Bot bo'lsa: Bot 80% ehtimollik bilan yutishi shart (4 marta yutib, 1 marta yutqazish)
        let botShouldWin = Math.random() < 0.80; 
        if (p1.isBot) {
            winnerId = botShouldWin ? p1.id : p2.id;
        } else {
            winnerId = botShouldWin ? p2.id : p1.id;
        }
    } else {
        // 👥 Odam VS Odam bo'lsa: Haqiqiy ochkolar bo'yicha aniqlanadi
        if (p1.result.isChu && p2.result.isChu) winnerId = null;
        else if (p1.result.isChu) winnerId = p2.id;
        else if (p2.result.isChu) winnerId = p1.id;
        else {
            if (p1.result.score > p2.result.score) winnerId = p1.id;
            else if (p2.result.score > p1.result.score) winnerId = p2.id;
            else winnerId = null;
        }
    }

    let finalStatusText = "";
    if (winnerId) {
        dbData.companyProfit += tax;
        if (winnerId === p1.id) {
            p1Data.balance += (netPrize - bet);
            p2Data.balance -= bet;
            finalStatusText = `${p1Data.name} yutdi! (${p1.result?.statusName || 'POZA'})`;
        } else {
            p2Data.balance += (netPrize - bet);
            p1Data.balance -= bet;
            finalStatusText = `${p2Data.name} yutdi! (${p2.result?.statusName || 'POZA'})`;
        }
    } else {
        finalStatusText = "DURANG (Mablagʻlar qaytarildi)";
    }

    // Bot agar yutqazib puli 1 mln dan kamayib ketsa, avtomat to'xtaydi (to admin to'ldirgunicha)
    saveToDatabase();

    // Klientlarga yuborish
    [p1, p2].forEach(p => {
        if (!p.isBot) {
            io.to(p.socketId).emit('game_over', {
                result: finalStatusText,
                p1Balance: p1Data.balance,
                p2Balance: p2Data.balance
            });
        }
    });

    // Botlar holatini tozalash
    p1Data.status = p1Data.balance >= 1000000 && p1Data.isBot ? "idle" : (p1Data.isBot ? "offline" : "idle");
    p2Data.status = p2Data.balance >= 1000000 && p2Data.isBot ? "idle" : (p2Data.isBot ? "offline" : "idle");

    broadcastAdminData();
    broadcastOnlineCount();
    delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('Server yoqildi.'); });
