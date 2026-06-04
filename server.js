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

// Oshiqning 4 ta tomoni
const OSHIQ_SIDES = ["Chika", "Puka", "Chū", "Oʻng"];

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

        // 4 ta oshiq tashlash
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

// Oshiq kombinatsiyasini aniqlash funksiyasi
function evaluateOshiq(sides) {
    let counts = { "Chika": 0, "Puka": 0, "Chū": 0, "Oʻng": 0 };
    sides.forEach(s => counts[s] = (counts[s] || 0) + 1);
    
    let uniqueCount = Object.keys(counts).filter(k => counts[k] > 0).length;
    let maxSame = Math.max(...Object.values(counts));

    // 1. 4 ta Chika bo'lsa
    if (counts["Chika"] === 4) {
        return { score: 100, statusName: "CHIKA! (4 ta Chika)", isChu: false };
    }
    // 2. 4 ta Puka bo'lsa
    if (counts["Puka"] === 4) {
        return { score: 95, statusName: "PUKA! (4 ta Puka)", isChu: false };
    }
    // 3. 4 xil tushsa (Siyo)
    if (uniqueCount === 4) {
        return { score: 90, statusName: "SIYO! (4 xil tushdi)", isChu: false };
    }
    // 4. 4 ta bir xil tursa (qolgan tomonlar)
    if (maxSame === 4) {
        return { score: 85, statusName: "4 URUGʻ!", isChu: false };
    }
    // 5. CHŪ holati: 1 ta alohida va 3 ta bir xil bo'lsa (yoki Chū aralashsa)
    if (maxSame === 3 || counts["Chū"] > 1) {
        return { score: 0, statusName: "CHŪ! (Omadsiz tushish)", isChu: true };
    }
    // 6. 3 ta bir xil tursa (Chu bo'lmagan holatda)
    if (maxSame === 3) {
        return { score: 70, statusName: "3 URUGʻ!", isChu: false };
    }

    // Oddiy holat uchun ochko (Chika=4, Puka=3, O'ng=2, Chu=0)
    let normalScore = 0;
    sides.forEach(s => {
        if (s === "Chika") normalScore += 4;
        if (s === "Puka") normalScore += 3;
        if (s === "Oʻng") normalScore += 2;
        if (s === "Chū") normalScore += 0;
    });

    return { score: normalScore, statusName: `Oddiy tushish (${normalScore} ochko)`, isChu: false };
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

    let p1Txt = `${p1.name} oshiqlari: [${p1.result.sides.join(' | ')}]\n➔ Natija: ${p1.result.statusName}`;
    let p2Txt = `${p2.name} oshiqlari: [${p2.result.sides.join(' | ')}]\n➔ Natija: ${p2.result.statusName}`;
    
    let winnerId = null;
    let finalResultStr = "";

    if (p1.result.isChu && p2.result.isChu) {
        finalResultStr = `Ikkala tomon ham CHŪ boʻldi! Durang. Pullar qaytarildi.`;
    } else if (p1.result.isChu) {
        winnerId = p2.id; 
    } else if (p2.result.isChu) {
        winnerId = p1.id; 
    } else {
        if (p1.result.score > p2.result.score) winnerId = p1.id;
        else if (p2.result.score > p1.result.score) winnerId = p2.id;
    }

    if (winnerId) {
        companyProfit += tax;
        if (winnerId === p1.id) {
            if (p1Data) p1Data.balance += (netPrize - bet);
            if (p2Data) p2Data.balance -= bet;
            finalResultStr = `🏆 ${p1.name} yutdi! (+${netPrize.toLocaleString()} soʻm)`;
        } else {
            if (p2Data) p2Data.balance += (netPrize - bet);
            if (p1Data) p1Data.balance -= bet;
            finalResultStr = `🏆 ${p2.name} yutdi! (+${netPrize.toLocaleString()} soʻm)`;
        }
    } else if (!p1.result.isChu && !p2.result.isChu) {
        finalResultStr = `Durang boʻldi! Pullar qaytarildi.`;
    }

    let fullReport = `${p1Txt}\n\n${p2Txt}\n\nNatija: ${finalResultStr}`;

    io.to(room.id).emit('game_over', {
        result: fullReport,
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
server.listen(PORT, () => console.log('OSHQ OʻYIN serveri tayyor...'));
