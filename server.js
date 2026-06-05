const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let players = [];
let gameState = 'waiting'; // waiting, playing
let timer = 20;

io.on('connection', (socket) => {
    console.log('Yangi o\'yinchi kirdi: ' + socket.id);

    socket.on('join', (name) => {
        players.push({ id: socket.id, name: name, balance: 300000 });
        io.emit('updatePlayers', players);
    });

    // 20 soniyalik sanoq logikasi
    socket.on('placeBet', (amount) => {
        if (gameState === 'waiting') {
            gameState = 'playing';
            let countdown = setInterval(() => {
                timer--;
                io.emit('timer', timer);
                if (timer <= 0) {
                    clearInterval(countdown);
                    calculateGameResult();
                    timer = 20;
                    gameState = 'waiting';
                }
            }, 1000);
        }
    });
});

function calculateGameResult() {
    // Bu yerda siz aytgan "3 urug'", "4 urug'", "Siyo" va h.k. mantiq bo'ladi
    console.log("O'yin natijasi aniqlandi");
    io.emit('gameOver', { status: 'result' });
}

http.listen(process.env.PORT || 3000, () => {
    console.log('Server 3000-portda ishlamoqda');
});
