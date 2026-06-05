const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// MANA SHU QATOR FAYLNI TO'G'RIDAN-TO'G'RI O'QIYDI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let users = {}; 
let adminTaxWallet = 0;
let currentBets = [];
let timer = 20;

const bots = [
    { id: 'bot1', name: 'Bot_Ali', balance: 5000000, isBot: true },
    { id: 'bot2', name: 'Bot_Vali', balance: 5000000, isBot: true },
    { id: 'bot3', name: 'Bot_Sardor', balance: 5000000, isBot: true },
    { id: 'bot4', name: 'Bot_Aziz', balance: 5000000, isBot: true },
    { id: 'bot5', name: 'Bot_Bek', balance: 5000000, isBot: true }
];

function rollDices() {
    return [
        Math.floor(Math.random() * 4),
        Math.floor(Math.random() * 4),
        Math.floor(Math.random() * 4),
        Math.floor(Math.random() * 4)
    ];
}

function getResultName(dices) {
    let counts = {0: 0, 1: 0, 2: 0, 3: 0};
    dices.forEach(d => counts[d]++);

    if (counts[2] === 4) return "4 Urug' (Katta Yutuq!)";
    if (counts[2] === 3) return "3 Urug' (Yutuq!)";
    if (counts[0] === 1 && counts[1] === 1 && counts[2] === 1 && counts[3] === 1) return "Siyo (Maxsus Yutuq!)";
    if (counts[0] === 4) return "Poza (Yutuq!)";
    if (counts[1] === 4) return "Chika (Yutuq!)";
    if ((counts[0] === 3 || counts[1] === 3) && counts[2] === 1) return "Chu (Omadsiz holat)";
    
    return "Oddiy holat";
}

setInterval(() => {
    timer--;
    io.emit('timer', timer);

    if (timer === 15 || timer === 10 || timer === 5) {
        let randomBot = bots[Math.floor(Math.random() * bots.length)];
        let amounts = [50000, 100000, 300000];
        let bet = amounts[Math.floor(Math.random() * amounts.length)];
        currentBets.push({ user: randomBot, amount: bet });
        io.emit('newBet', `${randomBot.name} ${bet} so'm tikdi.`);
    }

    if (timer <= 0) {
        let dices = rollDices();
        let resultText = getResultName(dices);
        
        let winner = currentBets.length > 0 ? currentBets[Math.floor(Math.random() * currentBets.length)] : null;
        
        if (winner) {
            let totalPot = currentBets.reduce((sum, b) => sum + b.amount, 0);
            let tax = totalPot * 0.02;
            adminTaxWallet += tax;
            let winAmount = totalPot - tax;

            if(!winner.user.isBot && users[winner.user.id]) {
                users[winner.user.id].balance += winAmount;
            }

            io.emit('gameResult', {
                dices: dices,
                result: resultText,
                winner: winner.user.name,
                winAmount: winAmount,
                tax: tax
            });
        } else {
            io.emit('gameResult', { dices: dices, result: resultText, winner: "Hech kim", winAmount: 0, tax: 0 });
        }

        currentBets = [];
        timer = 20;
        io.emit('updateOnline', Object.keys(users).length + bots.length);
    }
}, 1000);

io.on('connection', (socket) => {
    socket.on('login', (data) => {
        let userId = data.name + "_" + data.password;
        if (!users[userId]) {
            users[userId] = { id: userId, name: data.name, password: data.password, balance: 300000, isBot: false };
        }
        socket.userId = userId;
        socket.emit('loginSuccess', users[userId]);
        io.emit('updateOnline', Object.keys(users).length + bots.length);
    });

    socket.on('placeBet', (amount) => {
        let user = users[socket.userId];
        if (user && user.balance >= amount) {
            user.balance -= amount;
            currentBets.push({ user: user, amount: amount });
            socket.emit('balanceUpdated', user.balance);
            io.emit('newBet', `${user.name} ${amount} so'm tikdi.`);
        } else {
            socket.emit('errorMsg', "Balansda mablag' yetarli emas!");
        }
    });

    socket.on('disconnect', () => {
        io.emit('updateOnline', Object.keys(users).length + bots.length);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server ishga tushdi: Port ${PORT}`);
});
