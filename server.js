const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let companyProfit = 0;

// Onlayn o'yinchilar ro'yxati
let activePlayers = {};
// Kutish zalidagi (raqib qidirayotgan) o'yinchilar pool'i
let waitingLobby = []; 
let activeRooms = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    
    // 1. Ism bilan o'yinga kirish
    socket.on('register_player', (playerName) => {
        if (!playerName || playerName.trim() === "") {
            return socket.emit('error_msg', 'Iltimos, ismingizni kiriting!');
        }
        
        // Har bir yangi odamga 500,000 so'm boshlang'ich virtual pul beriladi
        activePlayers[socket.id] = {
            id: socket.id,
            name: playerName,
            balance: 500000,
            status: "idle" // idle, searching, playing
        };

        socket.emit('register_success', {
            name: playerName,
            balance: activePlayers[socket.id].balance,
            companyProfit: companyProfit
        });
    });

    // 2. Avtomatik Raqib Qidirish (Matchmaking)
    socket.on('find_opponent', (betAmount) => {
        const player = activePlayers[socket.id];
        if (!player) return;

        const bet = parseInt(betAmount);
        if (bet < 10000 || bet > 10000000) {
            return socket.emit('error_msg', 'Tikish miqdori 10,000 va 10,000,000 soʻm orasida boʻlishi shart!');
        }
        if (player.balance < bet) {
            return socket.emit('error_msg', 'Mablagʻingiz yetarli emas!');
        }

        player.status = "searching";
        
        // Xuddi shu pulni tikib kutib turgan raqibni qidirish
        let opponent = waitingLobby.find(p => p.bet === bet && p.id !== socket.id && activePlayers[p.id]?.status === "searching");

        if (opponent) {
            // Raqib topildi! O'yin xonasi ochamiz
            waitingLobby = waitingLobby.filter(p => p.id !== opponent.id); // lobbidan olish
            
            const roomId = "room_" + Date.now();
            player.status = "playing";
            activePlayers[opponent.id].status = "playing";

            activeRooms[roomId] = {
                id: roomId,
                bet: bet,
                players: [
                    { id: socket.id, name: player.name, dice: null },
                    { id: opponent.id, name: opponent.name, dice: null }
                ]
            };

            // Ikkala o'yinchini xonaga ulaymiz
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
            // Raqib yo'q bo'lsa, kutish zaliga qo'shish
            waitingLobby.push({ id: socket.id, bet: bet, name: player.name });
            socket.emit('waiting_mode', 'Raqib qidirilmoqda, iltimos kuting...');
        }
    });

    // 3. Shashqol tashlash
    socket.on('roll_dice', (roomId) => {
        const room = activeRooms[roomId];
        if (!room) return;

        const pIndex = room.players.findIndex(p => p.id === socket.id);
        if (pIndex === -1 || room.players[pIndex].dice !== null) return;

        room.players[pIndex].dice = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('player_rolled', { name: room.players[pIndex].name });

        // Ikkala o'yinchi ham tashlagan bo'lsa
        if (room.players[0].dice !== null && room.players[1].dice !== null) {
            evaluateWinner(room);
        }
    });

    // 4. Virtual pul sotib olish
    socket.on('buy_chips', () => {
        if (activePlayers[socket.id]) {
            activePlayers[socket.id].balance += 500000;
            socket.emit('balance_updated', activePlayers[socket.id].balance);
        }
    });

    // Aloqa uzilganda xonadan chiqarish
    socket.on('disconnect', () => {
        waitingLobby = waitingLobby.filter(p => p.id !== socket.id);
        delete activePlayers[socket.id];
    });
});

function evaluateWinner(room) {
    const p1 = room.players[0];
    const p2 = room.players[1];
    const bet = room.bet;
    
    let totalPool = bet * 2;
    let tax = Math.round(totalPool * 0.03); // 3% Kompaniya foydasi
    let netPrize = totalPool - tax;
    let result = "";

    let p1Data = activePlayers[p1.id];
    let p2Data = activePlayers[p2.id];

    if (p1.dice > p2.dice) {
        if (p1Data) p1Data.balance += (netPrize - bet);
        if (p2Data) p2Data.balance -= bet;
        companyProfit += tax;
        result = `${p1.name} yutdi! Toshlar: ${p1.dice} vs ${p2.dice}. (+${netPrize.toLocaleString()} soʻm)`;
    } else if (p2.dice > p1.dice) {
        if (p2Data) p2Data.balance += (netPrize - bet);
        if (p1Data) p1Data.balance -= bet;
        companyProfit += tax;
        result = `${p2.name} yutdi! Toshlar: ${p1.dice} vs ${p2.dice}. (+${netPrize.toLocaleString()} soʻm)`;
    } else {
        result = `Durang boʻldi! Toshlar: ${p1.dice} va ${p2.dice}. Pullar qaytarildi.`;
    }

    io.to(room.id).emit('game_over', {
        result,
        companyProfit,
        p1Id: p1.id,
        p1Balance: p1Data ? p1Data.balance : 0,
        p2Id: p2.id,
        p2Balance: p2Data ? p2Data.balance : 0
    });

    // O'yinchilar holatini tiklash
    if (p1Data) p1Data.status = "idle";
    if (p2Data) p2Data.status = "idle";
    delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server yangilandi...'));
