const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let timer = 20;
let isPlaying = false;
let onlineCount = 1245; // Hozirgi onlayn

io.on('connection', (socket) => {
    socket.emit('timer', timer);

    socket.on('placeBet', (amount) => {
        if (!isPlaying) {
            isPlaying = true;
            let countdown = setInterval(() => {
                timer--;
                io.emit('timer', timer);
                if (timer <= 0) {
                    clearInterval(countdown);
                    let tax = amount * 0.02;
                    io.emit('gameResult', "O'yin tugadi! Soliq olindi: " + tax);
                    timer = 20;
                    isPlaying = false;
                }
            }, 1000);
        }
    });
});

http.listen(process.env.PORT || 3000, () => {
    console.log('Server ishga tushdi!');
});
