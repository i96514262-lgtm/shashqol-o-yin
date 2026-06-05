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
    players: {}, // O'yinchilar bazasi
    usedIds: [], // Band bo'lgan 6 xonali ID'lar ro'yxati
    companyProfit: 0
};

// Bazani yuklash
if (fs.existsSync(DB_FILE)) {
    try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        dbData = JSON.parse(fileContent);
        if (!dbData.usedIds) dbData.usedIds = Object.keys(dbData.players);
    } catch (e) {
        console.log("Baza faylini o'qishda xato, yangi ochiladi.");
    }
}

function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

// 6 xonali takrorlanmas ID yaratish funksiyasi
function generateUniqueId() {
    let id;
    do {
        id = Math.floor(100000 + Math.random() * 900000).toString(); // 100000 dan 999999 gacha
    } while (dbData.usedIds.includes(id));
    dbData.usedIds.push(id);
    return id;
}

let onlineSockets = {}; 
let waitingLobby = []; 
let activeRooms = {};

const ADMIN_PASSWORD = "0613"; // 🔥 Admin paroli o'zgartirildi!
const OSHIQ_SIDES = ["Oʻng", "Chap", "Tik oʻng", "Tik chap"];

function getAdminPlayersList() {
    return Object.values(dbData.players).map(p => ({
        id: p.id,
        name: p.name,
        balance: p.balance
    }));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {

    // --- ADMIN PANEL ---
    socket.on('admin_login', (pass) => {
        if(pass === ADMIN_PASSWORD) {
            socket.emit('admin_auth_success', {
                profit: dbData.companyProfit,
                players: getAdminPlayersList()
            });
            socket.join('admin_room');
        } else {
            socket.emit('error_msg', 'Xato admin parol!');
        }
    });

    socket.on('admin_modify_balance', (data) => {
        const player = dbData.players[data.id];
        if (!player) return socket.emit('error_msg', 'Oʻyinchi topilmadi!');

        if (data.type === 'plus') {
            player.balance += data.amount;
        } else if (data.type === 'minus') {
            player.balance -= data.amount;
            if(player.balance < 0) player.balance = 0;
        }

        saveToDatabase();

        for (let sId in onlineSockets) {
            if (onlineSockets[sId] === data.id) {
                io.to(sId).emit('balance_updated', player.balance);
            }
        }

        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
        socket.emit('admin_action_success', `Muvaffaqiyatli bajarildi! Yangi balans: ${player.balance.toLocaleString()} so'm`);
    });

    // --- AKKAUNT RO'YXATDAN O'TISH VA KIRISH (AVTOMATIK TIZIM) ---
    socket.on('register_player', (data) => {
        let player;

        // 1. Agar foydalanuvchi tizimga qayta kirayotgan bo'lsa (ID va Parol bilan)
        if (data.id && dbData.players[data.id]) {
            let existingPlayer = dbData.players[data.id];

            // Parolni tekshirish
            if (existingPlayer.password !== data.password) {
                return socket.emit('error_msg', 'Xato ID yoki Parol kiritildi!');
            }
            player = existingPlayer;
        } 
        // 2. Agar foydalanuvchi birinchi marta kirayotgan bo'lsa (Yangi akkaunt)
        else {
            if (!data.name || data.name.trim() === "") {
                return socket.emit('error_msg', 'Iltimos, ismingizni kiriting!');
            }
            if (!data.password || data.password.toString().length !== 4) {
                return socket.emit('error_msg', 'Parol aniq 4 ta raqamdan iborat boʻlishi shart!');
            }

            let newId = generateUniqueId(); // 6 xonali ID yaratish
            
            player = {
                id: newId,
                name: data.name.trim(),
                password: data.password.toString(), // 4 xonali parol
                balance: 0, 
                status: "idle"
            };
            dbData.players[newId] = player;
            saveToDatabase();
        }

        onlineSockets[socket.id] = player.id;
        player.status = "idle";

        // Muvaffaqiyatli kirganda ma'lumotlarni telefonga qaytarish
        socket.emit('register_success', {
            id: player.id,
            name: player.name,
            balance: player.balance
        });

        io.emit('online_count', Object.keys(onlineSockets).length);
        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
    });

    // --- RAQIB QIDIRISH ---
    socket.on('find_opponent', (betAmount) => {
        const pId = onlineSockets[socket.id];
        const player = dbData.players[pId];
        if (!player) return;

        const bet = parseInt(betAmount);
        
        // Botlar uchun cheksiz balans (Ismida 'Bot' so'zi bo'lsa)
        if (player.name && player.name.includes("Bot")) {
            player.balance = 1000000; 
        } else {
            if (player.balance < bet) {
                return socket.emit('error_msg', 'Mablagʻingiz yetarli emas! Kassirga murojaat qiling.');
            }
        }

        player.status = "searching";
        
        let opponentData = waitingLobby.find(w => w.bet === bet && w.socketId !== socket.id && dbData.players[w.playerId]?.status === "searching");

        if (opponentData) {
            waitingLobby = waitingLobby.filter(w => w.socketId !== opponentData.socketId);
            const roomId = "room_" + Date.now();
            
            player.status = "playing";
            dbData.players[opponentData.playerId].status = "playing";

            activeRooms[roomId] = {
                id: roomId,
                bet: bet,
                players: [
                    { socketId: socket.id, id: player.id, name: player.name, result: null },
                    { socketId: opponentData.socketId, id: opponentData.playerId, name: dbData.players[opponentData.playerId].name, result: null }
                ],
                timeoutId: null
            };

            const oppSocket = io.sockets.sockets.get(opponentData.socketId);
            if (oppSocket) oppSocket.join(roomId);
            socket.join(roomId);

            io.to(roomId).emit('game_start', { 
                roomId: roomId, 
                bet: bet,
                p1: player.name,
                p2: dbData.players[opponentData.playerId].name
            });

            activeRooms[roomId].timeoutId = setTimeout(() => {
                handleRoomTimeout(roomId);
            }, 15000);

        } else {
            waitingLobby.push({ socketId: socket.id, playerId: player.id, bet: bet });
            socket.emit('waiting_mode', 'Raqib qidirilmoqda...');
        }
    });

    // --- TOSHLARNI TASHALASH ---
    socket.on('roll_dice', (roomId) => {
        const room = activeRooms[roomId];
        if (!room) return;

        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (pIndex === -1 || room.players[pIndex].result !== null) return;

        let rolledSides = [];
        for (let i = 0; i < 4; i++) {
            rolledSides.push(OSHIQ_SIDES[Math.floor(Math.random() * 4)]);
        }

        let evaluation = evaluateOshiq(rolledSides);
        room.players[pIndex].result = { score: evaluation.score, statusName: evaluation.statusName, isChu: evaluation.isChu };

        io.to(roomId).emit('player_rolled', { name: room.players[pIndex].name });

        if (room.players[0].result !== null && room.players[1].result !== null) {
            if (room.timeoutId) clearTimeout(room.timeoutId);
            evaluateWinner(room);
        }
    });

    socket.on('disconnect', () => {
        waitingLobby = waitingLobby.filter(w => w.socketId !== socket.id);
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            let pIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (pIndex !== -1) {
                if (room.timeoutId) clearTimeout(room.timeoutId);
                handleRoomTimeout(roomId);
            }
        }
        delete onlineSockets[socket.id];
        io.emit('online_count', Object.keys(onlineSockets).length);
    });
});

function handleRoomTimeout(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;

    let slacker = room.players.find(p => p.result === null);
    let activePlayer = room.players.find(p => p.result !== null || p.id !== slacker?.id);

    io.to(roomId).emit('error_msg', 'Oʻyinchilardan biri 15 soniya ichida harakat qilmadi! Oʻyin bekor qilindi.');
    io.to(roomId).emit('force_cancel_game');

    if (activePlayer && dbData.players[activePlayer.id]) dbData.players[activePlayer.id].status = "idle";
    if (slacker && dbData.players[slacker.id]) dbData.players[slacker.id].status = "idle";

    delete activeRooms[roomId];
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

function evaluateWinner(room) {
    const p1 = room.players[0];
    const p2 = room.players[1];
    const bet = room.bet;
    
    let totalPool = bet * 2;
    let tax = Math.round(totalPool * 0.03);
    let netPrize = totalPool - tax;

    let p1Data = dbData.players[p1.id];
    let p2Data = dbData.players[p2.id];
    
    let winnerId = null;
    let finalStatusText = "";

    if (p1.result.isChu && p2.result.isChu) {
        finalStatusText = "CHŪ (Durang)";
    } else if (p1.result.isChu) {
        winnerId = p2.id;
        finalStatusText = `${p2.name}: ${p2.result.statusName}`;
    } else if (p2.result.isChu) {
        winnerId = p1.id;
        finalStatusText = `${p1.name}: ${p1.result.statusName}`;
    } else {
        if (p1.result.score > p2.result.score) {
            winnerId = p1.id;
            finalStatusText = `${p1.name}: ${p1.result.statusName}`;
        } else if (p2.result.score > p1.result.score) {
            winnerId = p2.id;
            finalStatusText = `${p2.name}: ${p2.result.statusName}`;
        } else {
            finalStatusText = "DURANG";
        }
    }

    if (winnerId) {
        dbData.companyProfit += tax; 
        io.to('admin_room').emit('update_profit', dbData.companyProfit);
        
        if (winnerId === p1.id) {
            if (p1Data) p1Data.balance += (netPrize - bet);
            if (p2Data) p2Data.balance -= bet;
        } else {
            if (p2Data) p2Data.balance += (netPrize - bet);
            if (p1Data) p1Data.balance -= bet;
        }
    }

    saveToDatabase();

    io.to(room.id).emit('game_over', {
        result: finalStatusText,
        p1SocketId: p1.socketId, p1Balance: p1Data ? p1Data.balance : 0,
        p2SocketId: p2.socketId, p2Balance: p2Data ? p2Data.balance : 0
    });

    if (p1Data) p1Data.status = "idle";
    if (p2Data) p2Data.status = "idle";
    
    io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
    delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('OSHQ OʻYIN serveri yangilandi.');
    
    // Botlarni server ichida avtomat yoqish
    try {
        if (fs.existsSync(path.join(__dirname, 'bots.js'))) {
            require('./bots.js');
            console.log("Botlar tizimi muvaffaqiyatli serverga ulandi.");
        }
    } catch (e) {
        console.log("Botlarni yoqishda xatolik:", e);
    }
});
