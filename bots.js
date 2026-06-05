// bots.js
const { io } = require("socket.io-client");

// Render'dagi asosiy o'yin saytingiz manzili
const SERVER_URL = "https://shashqol-o-yin.onrender.com"; 

// Botlar faqat bir-biri bilan o'ynashi uchun maxsus summa (Haqiqiy o'yinchilar bu summani tanlamasligi kerak)
const BOT_BET_AMOUNT = 1; 

const botsConfig = [
    { id: 8881, name: "🤖 Bot_Olim" },
    { id: 8882, name: "🤖 Bot_Anvar" },
    { id: 8883, name: "🤖 Bot_Temur" }
];

const connectedBots = [];

botsConfig.forEach((botData) => {
    const socket = io(SERVER_URL);
    let currentRoomId = null;

    socket.on("connect", () => {
        console.log(`${botData.name} serverga ulandi.`);
        // Serverga ro'yxatdan o'tish so'rovi
        socket.emit("register_player", { id: botData.id, name: botData.name });
    });

    socket.on("register_success", () => {
        // Ro'yxatdan o'tgach, biroz kutib o'yin qidirishni boshlaydi (1 so'mlik o'yin)
        setTimeout(() => {
            socket.emit("find_opponent", BOT_BET_AMOUNT);
        }, Math.random() * 3000 + 1000);
    });

    socket.on("game_start", (data) => {
        currentRoomId = data.roomId;
        console.log(`${botData.name} o'yinga kirdi. Xona: ${currentRoomId}`);
        
        // 4 dan 7 soniyagacha tasodifiy vaqt ichida tosh tashlaydi (haqiqiy odamga o'xshash uchun)
        setTimeout(() => {
            if (currentRoomId) socket.emit("roll_dice", currentRoomId);
        }, Math.random() * 3000 + 4000);
    });

    socket.on("game_over", () => {
        currentRoomId = null;
        // O'yin tugagach, 8-12 soniya kutib, yana navbatga turadi
        setTimeout(() => {
            socket.emit("find_opponent", BOT_BET_AMOUNT);
        }, Math.random() * 4000 + 8000);
    });

    socket.on("force_cancel_game", () => {
        currentRoomId = null;
        setTimeout(() => {
            socket.emit("find_opponent", BOT_BET_AMOUNT);
        }, 5000);
    });

    socket.on("disconnect", () => {
        console.log(`${botData.name} uzildi, qayta ulanmoqda...`);
        currentRoomId = null;
    });

    connectedBots.push(socket);
});
