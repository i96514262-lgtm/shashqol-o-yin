const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let companyProfit = 0;

// Test uchun 2 ta akkaunt (ID: user123 va user456)
let players = {
    "user123": { name: "Oʻyinchi 1", balance: 500000, socketId: null },
    "user456": { name: "Oʻyinchi 2", balance: 200000, socketId: null }
};

let activeRooms = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('login', (accountId) => {
        if (players[accountId]) {
            players[accountId].socketId = socket.id;
            socket.accountId = accountId;
            socket.emit('login_success', {
                name: players[accountId].name,
                balance: players[accountId].balance,
                companyProfit: companyProfit
            });
        } else {
            socket.emit('login_error', 'Akkaunt topilmadi! (user123 yoki user456 deb kiring)');
        }
    });

    socket.on('join_room', ({ roomId, betAmount }) => {
        const accountId = socket.accountId;
        if (!accountId) return;
        const player = players[accountId];
        const bet = parseInt(betAmount);

        if (bet < 10000 || bet > 10000000 || player.balance < bet) {
            return socket.emit('error_msg', 'Mablagʻ yetarli emas yoki limit buzilgan!');
        }

        if (!activeRooms[roomId]) {
            activeRooms[roomId] = { id: roomId, bet: bet, players: [] };
        }
        const room = activeRooms[roomId];
        if (room.players.length >= 2) return socket.emit('error_msg', 'Xona toʻla!');

        room.players.push({ accountId, name: player.name, socketId: socket.id, dice: null });
        socket.join(roomId);
        io.to(roomId).emit('room_updated', room);

        if (room.players.length === 2) {
            io.to(roomId).emit('game_ready');
        }
    });

    socket.on('roll_dice', (roomId) => {
        const room = activeRooms[roomId];
        if (!room) return;
        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (pIndex === -1 || room.players[pIndex].dice !== null) return;

        room.players[pIndex].dice = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('player_rolled', { name: room.players[pIndex].name });

        if (room.players[0].dice !== null && room.players[1].dice !== null) {
            evaluateWinner(room);
        }
    });

    socket.on('buy_chips', (amount) => {
        const accountId = socket.accountId;
        if (accountId && players[accountId]) {
            players[accountId].balance += parseInt(amount);
            socket.emit('balance_updated', players[accountId].balance);
        }
    });
});

function evaluateWinner(room) {
    const p1 = room.players[0];
    const p2 = room.players[1];
    const bet = room.bet;
    let totalPool = bet * 2;
    let tax = Math.round(totalPool * 0.03);
    let netPrize = totalPool - tax;
    let result = "";

    if (p1.dice > p2.dice) {
        players[p1.accountId].balance += (netPrize - bet);
        players[p2.accountId].balance -= bet;
        companyProfit += tax;
        result = `${p1.name} yutdi! (+${netPrize.toLocaleString()} soʻm). Toshlar: ${p1.dice} vs ${p2.dice}`;
    } else if (p2.dice > p1.dice) {
        players[p2.accountId].balance += (netPrize - bet);
        players[p1.accountId].balance -= bet;
        companyProfit += tax;
        result = `${p2.name} yutdi! (+${netPrize.toLocaleString()} soʻm). Toshlar: ${p1.dice} vs ${p2.dice}`;
    } else {
        result = `Durang! Toshlar: ${p1.dice} va ${p2.dice}`;
    }

    io.to(room.id).emit('game_over', {
        result,
        p1Balance: players[p1.accountId].balance,
        p2Balance: players[p2.accountId].balance,
        companyProfit
    });
    delete activeRooms[room.id];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running...'));
