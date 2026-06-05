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
    nextPlayerId: 100000, // 🔥 6 xonali ID raqam shu yerdan boshlanadi
    companyProfit: 0
};

if (fs.existsSync(DB_FILE)) {
    try {
        dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.log("Baza o'qishda xato.");
    }
}

function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

let onlineSockets = {}; 
let waitingLobby = []; 
let activeRooms = {};

const ADMIN_PASSWORD = "0613";
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

    // ADMIN TIZIMI
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
        if (!player) return;
        if (data.type === 'plus') player.balance += data.amount;
        if (data.type === 'minus') {
            player.balance -= data.amount;
            if(player.balance < 0) player.balance = 0;
        }
        saveToDatabase();
        
        for (let sId in onlineSockets) {
            if (onlineSockets[sId] === parseInt(data.id)) {
                io.to(sId).emit('balance_updated', player.balance);
            }
        }
        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
    });

    // 🔐 RO'YXATDAN O'TISH VA TIZIMGA KIRISH (PAROL BILAN)
    socket.on('register_player', (data) => {
        let player;

        if (data.id) {
            // Eski foydalanuvchi ID orqali kirmoqchi bo'lganda
            player = dbData.players[data.id];
            if (!player) {
                return socket.emit('error_msg', 'Bunday ID raqamli profil mavjud emas!');
            }
            if (player.password !== data.password) {
                return socket.emit('error_msg', 'Xato parol kiritildi!');
            }
        } else {
            // Yangi foydalanuvchi ro'yxatdan o'tayotganda
            if (!data.name || data.name.trim() === "") return socket.emit('error_msg', 'Ism kiriting!');
            if (!data.password || data.password.length !== 4) return socket.emit('error_msg', 'Parol 4 xonali boʻlsin!');

            let newId = dbData.nextPlayerId++;
            player = {
                id: newId,
                name: data.name,
                password: data.password, // O'zgartirib bo'lmaydi
                balance: 0,
                status: "idle"
            };
            dbData.players[newId] = player;
            saveToDatabase();
        }

        onlineSockets[socket.id] = player.id;
        player.status = "idle";

        socket.emit('register_success', {
            id: player.id,
            name: player.name,
            balance: player.balance
        });

        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
    });

    // O'YIN TIKISh LOGIKASI
    socket.on('find_opponent', (betAmount) => {
        const pId = onlineSockets[socket.id];
        const player = dbData.players[pId];
        if (!player) return;

        const bet = parseInt(betAmount);
        if (player.name && player.name.includes("Bot")) {
            player.balance = 1000000;
        } else {
            if (player.balance < bet) return socket.emit('error_msg', 'Mablagʻ yetarli emas!');
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
                ]
            };

            const oppSocket = io.sockets.sockets.get(opponentData.socketId);
            if (oppSocket) oppSocket.join(roomId);
            socket.join(roomId);

            io.to(roomId).emit('game_start', { roomId: roomId, bet: bet, p1: player.name, p2: dbData.players[opponentData.playerId].name });
        } else {
            waitingLobby.push({ socketId: socket.id, playerId: player.id, bet: bet });
        }
    });

    socket.on('roll_dice', (roomId) => {
        const room = activeRooms[roomId];
        if (!room) return;
        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (pIndex === -1 || room.players[pIndex].result !== null) return;

        let rolledSides = [];
        for (let i = 0; i < 4; i++) rolledSides.push(OSHIQ_SIDES[Math.floor(Math.random() * 4)]);
        let evaluation = evaluateOshiq(rolledSides);
        room.players[pIndex].result = { score: evaluation.score, statusName: evaluation.statusName, isChu: evaluation.isChu };

        if (room.players[0].result !== null && room.players[1].result !== null) {
            evaluateWinner(room);
        }
    });

    socket.on('disconnect', () => {
        waitingLobby = waitingLobby.filter(w => w.socketId !== socket.id);
        delete onlineSockets[socket.id];
    });
});

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
    console.log('Server ishga tushdi.');
    try { if (fs.existsSync(path.join(__dirname, 'bots.js'))) require('./bots.js'); } catch (e) {}
});
