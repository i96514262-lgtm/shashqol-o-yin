const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let users = {}; 
let activeRooms = [];
let pendingBets = []; 
let adminBank = 100000000; // 100 mln boshlang'ich bank
let adminTaxProfit = 0; // Soliqdan yig'ilib turgan pul
const ADMIN_SECRET_PIN = "0613"; // Admin parol

let bots = {
    "Bot_Alisher": { username: "Bot_Alisher", pin: "0000", balance: 15000000, isBot: true, winStreak: 0 },
    "Bot_Madina": { username: "Bot_Madina", pin: "0000", balance: 15000000, isBot: true, winStreak: 1 },
    "Bot_Jasur": { username: "Bot_Jasur", pin: "0000", balance: 15000000, isBot: true, winStreak: 0 }
};

Object.assign(users, bots);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    
    updateGlobalStats();

    socket.on('auth', (data) => {
        const { username, pin } = data;
        if (!users[username]) {
            users[username] = {
                username: username,
                pin: pin,
                balance: 300000, 
                isBot: false,
                socketId: socket.id
            };
            socket.emit('auth_success', { username, balance: 300000, msg: "Xush kelibsiz! 300,000 so'm bonus berildi." });
        } else {
            if (users[username].pin === pin) {
                users[username].socketId = socket.id;
                socket.emit('auth_success', { username, balance: users[username].balance, msg: "Akkauntga qaytadingiz!" });
            } else {
                socket.emit('auth_error', "Xato PIN-kod yoki ushbu ism band!");
                return;
            }
        }
        socket.username = username;
        updateGlobalStats();
    });

    socket.on('place_bet', (amount) => {
        amount = parseInt(amount);
        const user = users[socket.username];
        if (!user || user.balance < amount) {
            socket.emit('error_msg', "Mablag' yetarli emas!");
            return;
        }

        user.balance -= amount;
        socket.emit('balance_update', user.balance);

        let opponent = pendingBets.find(b => b.amount === amount && b.username !== socket.username);

        if (opponent) {
            pendingBets = pendingBets.filter(b => b.socketId !== opponent.socketId);
            clearTimeout(opponent.timeoutId);
            startMatch(socket.username, socket.id, opponent.username, opponent.socketId, amount);
        } else {
            const timeoutId = setTimeout(() => {
                pendingBets = pendingBets.filter(b => b.socketId !== socket.id);
                user.balance += amount;
                socket.emit('balance_update', user.balance);
                socket.emit('error_msg', "20 soniyada raqib topilmadi. Pul qaytarildi.");
                
                if (amount === 700000 || amount === 1000000) {
                    activateBotMatch(socket.username, socket.id, amount);
                }
            }, 20000);

            pendingBets.push({ socketId: socket.id, username: socket.username, amount, timeoutId });
            socket.emit('waiting_match', `Raqib qidirilmoqda (${amount.toLocaleString()} so'm)...`);
        }
        updateGlobalStats();
    });

    socket.on('admin_auth', (inputPin) => {
        if (inputPin === ADMIN_SECRET_PIN) {
            socket.isAdmin = true;
            sendAdminData(socket);
        } else {
            socket.emit('admin_auth_failed', "Xato admin kodi! Ruxsat berilmadi.");
        }
    });

    // ADMIN AMALLARI
    socket.on('admin_action', (data) => {
        if (!socket.isAdmin) return;
        const { targetUser, action, amount } = data;
        if (users[targetUser]) {
            if (action === 'add' && adminBank >= amount) {
                users[targetUser].balance += amount;
                adminBank -= amount;
            } else if (action === 'withdraw' && users[targetUser].balance >= amount) {
                users[targetUser].balance -= amount;
                adminBank += amount; 
            }
            if (users[targetUser].socketId) {
                io.to(users[targetUser].socketId).emit('balance_update', users[targetUser].balance);
            }
            sendAdminData(io); 
        }
    });

    // SOLIQNI BANKKA O'TKAZISH JONLI MANTIQI
    socket.on('collect_tax_to_bank', () => {
        if (!socket.isAdmin) return;
        if (adminTaxProfit <= 0) {
            socket.emit('admin_msg', "O'tkazish uchun soliq xizmatida pul yo'q!");
            return;
        }
        // Soliq pullari o'chadi va bankka qo'shiladi
        adminBank += adminTaxProfit;
        adminTaxProfit = 0;
        
        sendAdminData(io); // hamma admin oynalarida ma'lumot yangilanadi
    });

    socket.on('disconnect', () => {
        pendingBets = pendingBets.filter(b => b.socketId !== socket.id);
        updateGlobalStats();
    });
});

function startMatch(p1Name, p1Socket, p2Name, p2Socket, amount) {
    const totalPrize = amount * 2;
    const tax = totalPrize * 0.02; 
    const winAmount = totalPrize - tax;
    adminTaxProfit += tax; 

    const p1Roll = Math.floor(Math.random() * 4); 
    const p2Roll = Math.floor(Math.random() * 4);

    let winnerName = p1Name;
    let winnerSocket = p1Socket;
    let loserName = p2Name;
    let r1 = "Alchi 👑", r2 = "Bok ❌";

    if (p2Roll < p1Roll) { 
        winnerName = p2Name; winnerSocket = p2Socket;
        loserName = p1Name; r1 = "Bok ❌"; r2 = "Alchi 👑";
    }

    users[winnerName].balance += winAmount;

    if(io.sockets.sockets.get(p1Socket)) io.to(p1Socket).emit('match_result', { win: winnerName === p1Name, roll: r1, oppRoll: r2, prize: winAmount, balance: users[p1Name].balance });
    if(io.sockets.sockets.get(p2Socket)) io.to(p2Socket).emit('match_result', { win: winnerName === p2Name, roll: r2, oppRoll: r1, prize: winAmount, balance: users[p2Name].balance });

    activeRooms.push({ p1: p1Name, p2: p2Name, amount: amount, winner: winnerName });
    if (activeRooms.length > 8) activeRooms.shift(); 

    sendAdminData(io);
}

function activateBotMatch(humanName, humanSocket, amount) {
    const botNames = Object.keys(bots);
    const selectedBot = users[botNames[Math.floor(Math.random() * botNames.length)]];
    
    users[humanName].balance -= amount;
    
    const totalPrize = amount * 2;
    const tax = totalPrize * 0.02;
    const winAmount = totalPrize - tax;
    adminTaxProfit += tax;

    let humanWins = true;
    if (selectedBot.winStreak === 0) {
        humanWins = false;
        selectedBot.winStreak = 1; 
    } else {
        selectedBot.winStreak = 0; 
    }

    if (humanWins) {
        users[humanName].balance += winAmount;
        io.to(humanSocket).emit('match_result', { win: true, roll: "Alchi 👑", oppRoll: "Bok ❌", prize: winAmount, balance: users[humanName].balance });
    } else {
        selectedBot.balance += winAmount;
        io.to(humanSocket).emit('match_result', { win: false, roll: "Tova 🛡️", oppRoll: "Alchi 👑", prize: 0, balance: users[humanName].balance });
    }

    activeRooms.push({ p1: humanName, p2: selectedBot.username, amount: amount, winner: humanWins ? humanName : selectedBot.username });
    sendAdminData(io);
}

function updateGlobalStats() {
    let onlineCount = Object.keys(io.sockets.sockets).length + 3; 
    io.emit('global_stats', { onlineCount, pendingCount: pendingBets.length });
}

function sendAdminData(target) {
    if (target.emit) {
        target.emit('admin_update', {
            adminBank,
            adminTaxProfit,
            users: Object.values(users).map(u => ({ username: u.username, balance: u.balance, isBot: u.isBot })),
            activeRooms
        });
    } else {
        target.sockets.sockets.forEach(s => {
            if (s.isAdmin) {
                s.emit('admin_update', {
                    adminBank,
                    adminTaxProfit,
                    users: Object.values(users).map(u => ({ username: u.username, balance: u.balance, isBot: u.isBot })),
                    activeRooms
                });
            }
        });
    }
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
