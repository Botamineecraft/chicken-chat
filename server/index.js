const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10e6 // 10MB
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'chicken-chat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        nickname TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_by TEXT REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id),
        content TEXT DEFAULT '',
        type TEXT DEFAULT 'text',
        file_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        file_type TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
`);

const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)');
const getUser = db.prepare('SELECT * FROM users WHERE nickname = ?');
const getAllUsers = db.prepare('SELECT * FROM users ORDER BY created_at');

const insertRoom = db.prepare('INSERT INTO rooms (id, name, description, created_by) VALUES (?, ?, ?, ?)');
const getAllRooms = db.prepare('SELECT r.*, u.nickname as creator_name FROM rooms r LEFT JOIN users u ON r.created_by = u.id ORDER BY r.created_at DESC');
const getRoom = db.prepare('SELECT * FROM rooms WHERE id = ?');

const insertMember = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)');
const removeMember = db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?');
const getRoomMembers = db.prepare('SELECT u.* FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?');

const insertMessage = db.prepare('INSERT INTO messages (id, room_id, user_id, content, type, file_url, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getMessages = db.prepare('SELECT m.*, u.nickname, u.id as user_id FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = ? ORDER BY m.created_at DESC LIMIT 100');

const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, uuidv4() + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/', 'video/', 'audio/', 'application/', 'text/'];
        if (allowed.some(t => file.mimetype.startsWith(t))) {
            cb(null, true);
        } else {
            cb(new Error('Неподдерживаемый тип файла'));
        }
    }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api/upload', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Нет файла' });
    res.json({
        url: '/uploads/' + req.file.filename,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
    });
});

app.get('/api/rooms', (req, res) => {
    res.json(getAllRooms.all());
});

app.get('/api/messages/:roomId', (req, res) => {
    const messages = getMessages.all(req.params.roomId).reverse();
    res.json(messages);
});

app.post('/api/rooms', (req, res) => {
    const { name, description, userId } = req.body;
    if (!name || !userId) return res.status(400).json({ error: 'Нет имени или userId' });
    const id = uuidv4();
    insertRoom.run(id, name, description || '', userId);
    insertMember.run(id, userId);
    res.json({ id, name });
});

io.on('connection', (socket) => {
    let currentUser = null;
    let currentRoom = null;

    socket.on('login', (nickname, callback) => {
        nickname = nickname.trim().substring(0, 20);
        if (!nickname) {
            callback({ error: 'Введи ник!' });
            return;
        }

        let user = getUser.get(nickname);
        if (!user) {
            const id = uuidv4();
            insertUser.run(id, nickname);
            user = { id, nickname };
        }

        currentUser = user;
        socket.user = user;

        const rooms = getAllRooms.all();
        const allUsers = getAllUsers.all();

        callback({
            success: true,
            user,
            rooms,
            allUsers
        });

        io.emit('user_list', getAllUsers.all());
        console.log(`${nickname} вошёл в чат`);
    });

    socket.on('create_room', (data, callback) => {
        if (!currentUser) return;
        const { name, description } = data;
        if (!name) { callback({ error: 'Нет имени' }); return; }

        const id = uuidv4();
        insertRoom.run(id, name, description || '', currentUser.id);
        insertMember.run(id, currentUser.id);

        const room = getRoom.get(id);
        io.emit('room_created', room);
        callback({ success: true, room });
    });

    socket.on('join_room', (roomId, callback) => {
        if (!currentUser) return;
        const room = getRoom.get(roomId);
        if (!room) { callback({ error: 'Комната не найдена' }); return; }

        if (currentRoom) {
            socket.leave(currentRoom);
            io.to(currentRoom).emit('user_left', { user: currentUser, room: currentRoom });
        }

        insertMember.run(roomId, currentUser.id);
        currentRoom = roomId;
        socket.join(roomId);

        const messages = getMessages.all(roomId).reverse();
        const members = getRoomMembers.all(roomId);
        const onlineUsers = getOnlineUsersInRoom(roomId);

        callback({ success: true, room, messages, members, onlineUsers });
        io.to(roomId).emit('user_joined', { user: currentUser, room: roomId });
        io.to(roomId).emit('online_users', getOnlineUsersInRoom(roomId));
    });

    socket.on('leave_room', () => {
        if (!currentRoom || !currentUser) return;
        socket.leave(currentRoom);
        io.to(currentRoom).emit('user_left', { user: currentUser, room: currentRoom });
        io.to(currentRoom).emit('online_users', getOnlineUsersInRoom(currentRoom));
        currentRoom = null;
    });

    socket.on('send_message', (data, callback) => {
        if (!currentUser || !currentRoom) return;
        const { content, type, fileUrl, fileName, fileType } = data;
        if (!content && !fileUrl) return;

        const id = uuidv4();
        insertMessage.run(id, currentRoom, currentUser.id, content || '', type || 'text', fileUrl || '', fileName || '', fileType || '');

        const msg = {
            id,
            room_id: currentRoom,
            user_id: currentUser.id,
            nickname: currentUser.nickname,
            content: content || '',
            type: type || 'text',
            file_url: fileUrl || '',
            file_name: fileName || '',
            file_type: fileType || '',
            created_at: new Date().toISOString()
        };

        io.to(currentRoom).emit('new_message', msg);
        if (callback) callback({ success: true });
    });

    socket.on('typing', () => {
        if (!currentUser || !currentRoom) return;
        socket.to(currentRoom).emit('user_typing', { user: currentUser.nickname, room: currentRoom });
    });

    socket.on('disconnect', () => {
        if (currentRoom && currentUser) {
            io.to(currentRoom).emit('user_left', { user: currentUser, room: currentRoom });
            io.to(currentRoom).emit('online_users', getOnlineUsersInRoom(currentRoom));
        }
        if (currentUser) {
            console.log(`${currentUser.nickname} вышел`);
            io.emit('user_list', getAllUsers.all());
        }
    });
});

function getOnlineUsersInRoom(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room) return [];
    const onlineUserIds = new Set();
    for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        if (s && s.user) onlineUserIds.add(s.user.id);
    }
    const allMembers = getRoomMembers.all(roomId);
    return allMembers.filter(u => onlineUserIds.has(u.id));
}

server.listen(PORT, () => {
    console.log(`Chicken Chat запущен на порту ${PORT}`);
});
