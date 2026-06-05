const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); // Fayllar bilan ishlash uchun modul

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DB_FILE = path.join(__dirname, 'database.json');

// Baza faylini yuklash yoki yangi yaratish
let dbData = {
    players: {},
    nextPlayerId: 1001,
    companyProfit: 0
};

if (fs.existsSync(DB_FILE)) {
    try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        dbData = JSON.parse(fileContent);
    } catch (e) {
        console.log("Baza faylini o'qishda xato, yangi ochiladi.");
    }
}

// Ma'lumotlarni faylga saqlash funksiyasi
function saveToDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
}

let onlineSockets = {}; // socket.id -> playerId
let waitingLobby = []; 
let activeRooms = {};

const ADMIN_PASSWORD = "izzatbek2006"; 
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

    // ADMIN: Tizimga kirish
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

    // ADMIN: Balansni o'zgartirish
    socket.on('admin_modify_balance', (data) => {
        const player = dbData.players[data.id];
        if (!player) return socket.emit('error_msg', 'Oʻyinchi topilmadi!');

        if (data.type === 'plus') {
            player.balance += data.amount;
        } else if (data.type === 'minus') {
            player.balance -= data.amount;
            if(player.balance < 0) player.balance = 0;
        }

        saveToDatabase(); // Faylga saqlash

        for (let sId in onlineSockets) {
            if (onlineSockets[sId] === data.id) {
                io.to(sId).emit('balance_updated', player.balance);
            }
        }

        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
        socket.emit('admin_action_success', `Muvaffaqiyatli bajarildi! Yangi balans: ${player.balance.toLocaleString()} so'm`);
    });

    // OʻYINCHI: Kirish yoki avtomatik ID tekshirish
    socket.on('register_player', (data) => {
        let player;
        
        // Agar mijozda eski saqlangan ID bo'lsa va u bazada bor bo'lsa
        if (data.id && dbData.players[data.id]) {
            player = dbData.players[data.id];
            // Agar ismini yangilamoqchi bo'lsa
            if (data.name && data.name.trim() !== "") {
                player.name = data.name;
            }
        } else {
            // Yangi akkaunt yaratish
            if (!data.name || data.name.trim() === "") {
                return socket.emit('error_msg', 'Iltimos, ismingizni kiriting!');
            }
            let newId = dbData.nextPlayerId++;
            player = {
                id: newId,
                name: data.name,
                balance: 500000, 
                status: "idle"
            };
            dbData.players[newId] = player;
        }

        saveToDatabase(); // Faylga saqlash

        onlineSockets[socket.id] = player.id;
        player.status = "idle";

        socket.emit('register_success', {
            id: player.id,
            name: player.name,
            balance: player.balance
        });

        io.emit('online_count', Object.keys(onlineSockets).length);
        io.to('admin_room').emit('admin_players_update', getAdminPlayersList());
    });

    // OʻYINCHI: Raqib qidirish
    socket.on('find_opponent', (betAmount) => {
        const pId = onlineSockets[socket.id];
        const player = dbData.players[pId];
        if (!player) return;

        const bet = parseInt(betAmount);
        if (player.balance < bet) {
            return socket.emit('error_msg', 'Mablagʻingiz yetarli emas!');
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

    // OʻYINCHI: Oshiq tashlash
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
        dbData.companyProfit += tax; // Kassaga tushgan soliq puli
        io.to('admin_room').emit('update_profit', dbData.companyProfit);
        
        if (winnerId === p1.id) {
            if (p1Data) p1Data.balance += (netPrize - bet);
            if (p2Data) p2Data.balance -= bet;
        } else {
            if (p2Data) p2Data.balance += (netPrize - bet);
            if (p1Data) p1Data.balance -= bet;
        }
    }

    saveToDatabase(); // Har o'yin tugaganda natijalarni faylga muhrlash

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
server.listen(PORT, () => console.log('OSHQ OʻYIN serveri doimiy faylli baza bilan tayyor.'));
