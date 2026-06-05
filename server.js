const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let users = {}; 
let timer = 20;

// O'yin vaqti
setInterval(() => {
    timer--;
    if (timer < 0) timer = 20;
    io.emit('timer', timer);
}, 1000);

io.on('connection', (socket) => {
    socket.on('login', (name) => {
        users[socket.id] = { name: name, balance: 300000 };
        socket.emit('auth', users[socket.id]);
    });

    socket.on('bet', (amt) => {
        if (users[socket.id] && users[socket.id].balance >= amt) {
            users[socket.id].balance -= amt;
            socket.emit('update', users[socket.id].balance);
        }
    });
});

http.listen(process.env.PORT || 3000, () => console.log("Server ishga tushdi"));
