const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let companyProfit = 0; 
let activePlayers = {};
let waitingLobby = []; 
let activeRooms = {};

// Oshiqning haqiqiy 4 ta tomoni
const OSHIQ_SIDES = ["Oʻng", "Chap", "Tik oʻng", "Tik chap"];

function broadcastOnlineCount() {
    io.emit('online_count', Object.keys(activePlayers).length);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    
    socket.on('register_player', (playerName) => {
        if (!playerName || playerName.trim() === "") {
            return socket.emit('error_msg', 'Iltimos, ismingizni kiriting!');
        }
        
        activePlayers[socket.id] = {
            id: socket.id,
            name: playerName,
            balance: 500000,
            status: "idle"
        };

        socket.emit('register_success', {
            name: playerName,
            balance: activePlayers[socket.id].balance
        });

        broadcastOnlineCount();
    });

    socket.on('find_opponent', (betAmount) => {
        const player = activePlayers[socket.id];
        if (!player) return;

        const bet = parseInt(betAmount);
        if (player.balance < bet) {
            return socket.emit('error_msg', 'Mablagʻingiz yetarli emas!');
        }

        player.status = "searching";
        let opponent = waitingLobby.find(p => p.bet === bet && p.id !== socket.id && activePlayers[p.id]?.status === "searching");

        if (opponent) {
            waitingLobby = waitingLobby.filter(p => p.id !== opponent.id);
            const roomId = "room_" + Date.now();
            player.status = "playing";
            activePlayers[opponent.id].status = "playing";

            activeRooms[roomId] = {
                id: roomId,
                bet: bet,
                players: [
                    { id: socket.id, name: player.name, result: null },
                    { id: opponent.id, name: opponent.name, result: null }
                ]
            };

            const oppSocket = io.sockets.sockets.get(opponent.id);
            if (oppSocket) oppSocket.join(roomId);
            socket.join(roomId);

            io.to(roomId).emit('game_start', {
                roomId: roomId,
                bet: bet,
                p1: player.name,
                p2: opponent.name
            });
        } else {
            waitingLobby.push({ id: socket.id, bet: bet, name: player.name });
            socket.emit('waiting_mode', 'Raqib qidirilmoqda...');
        }
    });

    socket.on('roll_dice', (roomId) => {
        const room = activeRooms[roomId];
        if (!room) return;

        const pIndex = room.players.findIndex(p => p.id === socket.id);
        if (pIndex === -1 || room.players[pIndex].result !== null) return;

        let rolledSides = [];
        for (let i = 0; i < 4; i++) {
            let rand = Math.floor(Math.random() * 4);
            rolledSides.push(OSHIQ_SIDES[rand]);
        }

        let evaluation = evaluateOshiq(rolledSides);
        room.players[pIndex].result = {
            sides: rolledSides,
            score: evaluation.score,
            statusName: evaluation.statusName,
            isChu: evaluation.isChu
        };

        io.to(roomId).emit('player_rolled', { name: room.players[pIndex].name });

        if (room.players[0].result !== null && room.players[1].result !== null) {
            evaluateWinner(room);
        }
    });

    socket.on('buy_chips', () => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].balance += 500000;
            socket.emit('balance_updated', activePlayers[socket.id].balance);
        }
    });

    socket.on('disconnect', () => {
        waitingLobby = waitingLobby.filter(p => p.id !== socket.id);
        delete activePlayers[socket.id];
        broadcastOnlineCount();
    });
});

function evaluateOshiq(sides) {
    let counts = { "Oʻng": 0, "Chap": 0, "Tik oʻng": 0, "Tik chap": 0 };
    sides.forEach(s => counts[s] = (counts[s] || 0) + 1);
    
    let uniqueCount = Object.keys(counts).filter(k => counts[k] > 0).length;
    let maxSame = Math.max(...Object.values(counts));

    // Tikka turganlar soni
    let tikkaSoni = counts["Tik oʻng"] + counts["Tik chap"];

    // 1. SIYO - 4 xil tomon tushsa (Oliy yutuq)
    if (uniqueCount === 4) {
        return { score: 100, statusName: "SIYO", isChu: false };
    }

    // 2. 4 URUGʻ - 4 tasi ham tik turgan bo'lsa
    if (tikkaSoni === 4) {
        return { score: 90, statusName: "4 URUGʻ", isChu: false };
    }

    // 3. 3 URUGʻ - 3 tasi tik turgan bo'lsa
    if (tikkaSoni === 3) {
        return { score: 80, statusName: "3 URUGʻ", isChu: false };
    }

    // 4. CHŪ - 1 ta alohida va qolgan 3 tasi bir xil bo'lib yotsa (Omadsiz holat)
    if (maxSame === 3) {
        return { score: 0, statusName: "CHŪ", isChu: true };
    }

    // 5. POZA - Oddiy yutuq holati (Ochkolar yig'indisi)
    // Tikka tomonlarga ko'proq ochko beriladi
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

    let p1Data = activePlayers[p1.id];
    let p2Data = activePlayers[p2.id];
    
    let winnerId = null;
    let finalStatusText = "";

    if (p1.result.isChu && p2.result.isChu) {
        finalStatusText = "CHŪ (Ikkala tomon ham omadsiz - Durang)";
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
        companyProfit += tax;
        if (winnerId === p1.id) {
            if (p1Data) p1Data.balance += (netPrize - bet);
            if (p2Data) p2Data.balance -= bet;
        } else {
            if (p2Data) p2Data.balance += (netPrize - bet);
            if (p1Data) p1Data.balance -= bet;
        }
    }

    io.to(room.id).emit('game_over', {
        result: finalStatusText,
        p1Id: p1.id,
        p1Balance: p1Data ? p1Data.balance : 0,
        p2Id: p2.id,
        p2Balance: p2Data ? p2Data.balance : 0
    });

    if (p1Data) p1Data.status = "idle";
    if (p2Data) p2Data.status = "idle";
    delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('OSHQ OʻYIN haqiqiy tomonlar bilan tayyor...'));
