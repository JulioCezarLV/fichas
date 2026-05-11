const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Banco de dados em memória
let users = { admin: "1234" };
let onlineUsers = {};
let globalChat = [];
let muralPosts = [];
let gameScores = [];
let activeGames = {};

// Salvar dados periodicamente
const fs = require('fs');
const DATA_FILE = 'data.json';

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        users = data.users || { admin: "1234" };
        globalChat = data.chat || [];
        muralPosts = data.mural || [];
        gameScores = data.scores || [];
    }
}
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        users, chat: globalChat.slice(-200),
        mural: muralPosts.slice(-100), scores: gameScores.slice(-100)
    }));
}
loadData();
setInterval(saveData, 60000);

io.on('connection', (socket) => {
    console.log(`🔌 Novo cliente: ${socket.id}`);

    // LOGIN
    socket.on('login', (data) => {
        const { username, password } = data;
        if (users[username] && users[username] === password) {
            onlineUsers[socket.id] = username;
            socket.username = username;
            socket.emit('login_success', {
                username,
                onlineUsers: Object.values(onlineUsers),
                chatHistory: globalChat.slice(-50),
                muralHistory: muralPosts.slice(-30),
                scores: gameScores.slice(-30)
            });
            io.emit('user_joined', {
                username,
                onlineUsers: Object.values(onlineUsers)
            });
            console.log(`✅ ${username} entrou`);
        } else {
            socket.emit('login_error', { message: 'Usuário ou senha inválidos' });
        }
    });

    // REGISTRO
    socket.on('register', (data) => {
        const { username, password } = data;
        if (users[username]) {
            socket.emit('register_error', { message: 'Usuário já existe!' });
        } else {
            users[username] = password;
            saveData();
            socket.emit('register_success', { message: 'Conta criada!' });
            console.log(`📝 Novo usuário: ${username}`);
        }
    });

    // CHAT
    socket.on('chat_message', (data) => {
        const msg = {
            user: socket.username,
            text: data.text,
            time: new Date().toLocaleTimeString(),
            id: Date.now()
        };
        globalChat.push(msg);
        if (globalChat.length > 200) globalChat.shift();
        io.emit('new_message', msg);
    });

    // MURAL
    socket.on('mural_post', (data) => {
        const post = {
            author: socket.username,
            text: data.text,
            date: new Date().toLocaleString(),
            id: Date.now()
        };
        muralPosts.unshift(post);
        if (muralPosts.length > 100) muralPosts.pop();
        io.emit('new_mural', post);
    });

    // RANKING
    socket.on('add_score', (data) => {
        const score = {
            user: socket.username,
            game: data.game,
            score: data.score,
            date: new Date().toLocaleString()
        };
        gameScores.unshift(score);
        if (gameScores.length > 100) gameScores.pop();
        io.emit('score_update', gameScores.slice(0, 30));
        saveData();
    });

    // DESAFIO BATALHA NAVAL
    socket.on('naval_challenge', (data) => {
        const targetSocket = Object.keys(onlineUsers).find(key => onlineUsers[key] === data.to);
        if (targetSocket) {
            io.to(targetSocket).emit('naval_challenge_received', {
                from: socket.username,
                challengeId: data.challengeId
            });
        } else {
            socket.emit('naval_error', { message: 'Usuário offline' });
        }
    });

    socket.on('naval_accept', (data) => {
        const challengerSocket = Object.keys(onlineUsers).find(key => onlineUsers[key] === data.to);
        if (challengerSocket) {
            const gameId = Date.now();
            activeGames[gameId] = {
                id: gameId,
                player1: data.to,
                player2: socket.username,
                turn: data.to
            };
            io.to(challengerSocket).emit('naval_start', {
                gameId,
                opponent: socket.username,
                yourTurn: true
            });
            socket.emit('naval_start', {
                gameId,
                opponent: data.to,
                yourTurn: false
            });
        }
    });

    socket.on('naval_move', (data) => {
        const game = activeGames[data.gameId];
        if (!game) return;
        const opponent = game.player1 === socket.username ? game.player2 : game.player1;
        const opponentSocket = Object.keys(onlineUsers).find(key => onlineUsers[key] === opponent);
        if (opponentSocket) {
            io.to(opponentSocket).emit('naval_move_received', {
                gameId: data.gameId,
                row: data.row,
                col: data.col,
                hit: data.hit
            });
        }
    });

    // FICHA - salvar dados do usuário
    socket.on('save_ficha', (data) => {
        const key = `ficha_${socket.username}`;
        if (!global.fichaData) global.fichaData = {};
        global.fichaData[key] = data;
        socket.emit('ficha_saved', { success: true });
    });

    socket.on('get_ficha', () => {
        const key = `ficha_${socket.username}`;
        socket.emit('ficha_data', global.fichaData?.[key] || null);
    });

    // DESCONEXÃO
    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.id];
            io.emit('user_left', {
                username: socket.username,
                onlineUsers: Object.values(onlineUsers)
            });
            console.log(`🔴 ${socket.username} saiu`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📡 Socket.IO ativo - Multiplayer REAL funcionando!`);
});