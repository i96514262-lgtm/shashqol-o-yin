const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/oshiqlar";

mongoose.connect(MONGO_URI)
  .then(async () => {
      console.log('MongoDB muvaffaqiyatli ulandi!');
      await initsializatsiya();
  })
  .catch(err => console.error('Baza xatosi:', err));

const UserSchema = new mongoose.Schema({ 
    username: String, 
    balance: { type: Number, default: 5000000 },
    botGameCounter: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);
let activeRooms = [];

async function initsializatsiya() {
    try {
        // Asosiy o'yinchi borligini tekshirish
        let mainUser = await User.findOne({ username: "Iz" });
        if (!mainUser) await new User({ username: "Iz", balance: 5000000 }).save();

        // Rasmdagi botlarni bazaga yuklash (agar yo'q bo'lsa)
        const boshlangichBotlar = [
            { username: "Bot_Alisher", balance: 15980000 },
            { username: "Bot_Madina", balance: 23220000 },
            { username: "Bot_Jasur", balance: 20640000 },
            { username: "Bot_Sardor", balance: 22220000 },
            { username: "Bot_Farrux", balance: 19040000 }
        ];

        for (let b of boshlangichBotlar) {
            let mavjud = await User.findOne({ username: b.username });
            if (!mavjud) await new User(b).save();
        }
    } catch(e) { console.log(e); }
}

io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => { socket.join(roomId); });
});

app.post('/api/matchmake', async (req, res) => {
    const { username, betAmount } = req.body;
    let user = await User.findOne({ username });
    if (!user || user.balance < betAmount) return res.status(400).json({ success: false });

    let room = activeRooms.find(r => r.betAmount === betAmount && r.status === 'waiting');
    if (room) {
        room.player2 = username; room.status = 'playing';
        user.balance -= betAmount; await user.save();
        io.to(room.roomId).emit('match-started', { room });
        return res.json({ success: true, room });
    } else {
        let roomId = "room_" + Date.now();
        let newRoom = { roomId, betAmount, player1: username, player2: null, status: 'waiting', p1Rolled: false, p2Rolled: false };
        user.balance -= betAmount; await user.save();
        activeRooms.push(newRoom);

        // Robot o'zi ulanishi (1.2M xonadan tashqari)
        if (betAmount !== 1200000) {
            setTimeout(async () => {
                let currentRoom = activeRooms.find(r => r.roomId === roomId);
                if (currentRoom && !currentRoom.player2) {
                    const botlar = await User.find({ username: { $regex: /Bot_/ } });
                    let tanlanganBot = botlar[Math.floor(Math.random() * botlar.length)];
                    
                    currentRoom.player2 = tanlanganBot.username;
                    currentRoom.status = 'playing';
                    
                    io.to(roomId).emit('match-started', { room: currentRoom });
                }
            }, 2000);
        }
        return res.json({ success: true, room: newRoom });
    }
});

app.post('/api/roll-dice', async (req, res) => {
    const { roomId, username } = req.body;
    let room = activeRooms.find(r => r.roomId === roomId);
    if (!room) return res.status(404).json({ success: false });

    if (room.player1 === username) room.p1Rolled = true;
    if (room.player2 === username) room.p2Rolled = true;

    // Raqib bot bo'lsa avtomat yuradi
    if (room.player1.startsWith('Bot_')) room.p1Rolled = true;
    if (room.player2.startsWith('Bot_')) room.p2Rolled = true;

    if (room.p1Rolled && room.p2Rolled) {
        let p1Score = Math.floor(Math.random() * 6) + 1;
        let p2Score = Math.floor(Math.random() * 6) + 1;
        if (p1Score === p2Score) p1Score = p1Score === 6 ? 5 : p1Score + 1;

        let golibIsm = p1Score > p2Score ? room.player1 : room.player2;
        let jamiYutuq = room.betAmount * 2;
        let soliq = Math.floor(jamiYutuq * 0.02);

        let golibUser = await User.findOne({ username: golibIsm });
        if (golibUser) {
            golibUser.balance += (jamiYutuq - soliq);
            await golibUser.save();
        }

        io.to(room.roomId).emit('game-finished', { 
            result: `O'yin tugadi! G'olib: ${golibIsm} (${p1Score} - ${p2Score})`
        });
        activeRooms = activeRooms.filter(r => r.roomId !== room.roomId);
        return res.json({ success: true });
    }
    res.json({ success: true });
});

app.get('/api/users-list', async (req, res) => {
    let users = await User.find({}).sort({ balance: -1 });
    res.json({ success: true, users });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server ${PORT}-portda muvaffaqiyatli ishladi.`));
