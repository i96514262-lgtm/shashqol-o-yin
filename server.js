const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let players = [];
let timer = 20;
let isPlaying = false;

// 5 ta Bot yaratish
let bots = [
    { id: 'bot1', name: 'Bot_Ali', balance: 1000000 },
    { id: 'bot2', name: 'Bot_Vali', balance: 1000000 },
    { id: 'bot3', name: 'Bot_Sardor', balance: 1000000 },
    { id: 'bot4', name: 'Bot_Aziz', balance: 1000000 },
    { id: 'bot5', name: 'Bot_Bek', balance: 1000000 }
];

io.on('connection', (socket) => {
    socket.on('join', (user) => {
        players.push({ id: socket.id, name: user.name, balance: 300000 });
        io.emit('updatePlayers', players.length + bots.length);
    });

    socket.on('placeBet', (amount) => {
        if (!isPlaying) {
            isPlaying = true;
            let countdown = setInterval(() => {
                timer--;
                io.emit('timer', timer);
                if (timer <= 0) {
                    clearInterval(countdown);
                    // O'yin natijasini hisoblash (Soliq 2%)
                    let tax = amount * 0.02;
                    let winnerGain = amount - tax;
                    io.emit('gameResult', "O'yin tugadi! Yutuq: " + winnerGain);
                    
                    timer = 20;
                    isPlaying = false;
                }
            }, 1000);
        }
    });
});

http.listen(process.env.PORT || 3000, () => {
    console.log('Server 24/7 rejimida ishga tushdi!');
});
