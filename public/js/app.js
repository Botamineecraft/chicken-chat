const socket = io();

let currentUser = null;
let currentRoom = null;
let allRooms = [];
let allUsers = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
}

// ===== LOGIN =====
$('#login-btn').addEventListener('click', doLogin);
$('#nickname-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
});

function doLogin() {
    const nickname = $('#nickname-input').value.trim();
    if (!nickname) {
        $('#login-error').textContent = 'Введи ник!';
        return;
    }
    $('#login-error').textContent = '';

    socket.emit('login', nickname, (res) => {
        if (res.error) {
            $('#login-error').textContent = res.error;
            return;
        }
        currentUser = res.user;
        allRooms = res.rooms;
        allUsers = res.allUsers;

        $('#current-user-name').textContent = currentUser.nickname;
        const initial = currentUser.nickname.charAt(0).toUpperCase();
        $('#my-avatar').textContent = initial;

        renderRoomList();
        renderUserList();
        showScreen('chat-screen');
    });
}

$('#logout-btn').addEventListener('click', () => {
    location.reload();
});

// ===== ROOMS =====
$('#create-room-btn').addEventListener('click', () => {
    $('#create-room-modal').classList.remove('hidden');
    $('#room-name-input').focus();
});

$('#cancel-room-btn').addEventListener('click', () => {
    $('#create-room-modal').classList.add('hidden');
    $('#room-name-input').value = '';
    $('#room-desc-input').value = '';
});

$('#confirm-room-btn').addEventListener('click', () => {
    const name = $('#room-name-input').value.trim();
    const desc = $('#room-desc-input').value.trim();
    if (!name) return;

    socket.emit('create_room', { name, description: desc }, (res) => {
        if (res.error) { alert(res.error); return; }
        allRooms.unshift(res.room);
        renderRoomList();
        joinRoom(res.room.id);
        $('#create-room-modal').classList.add('hidden');
        $('#room-name-input').value = '';
        $('#room-desc-input').value = '';
    });
});

function renderRoomList() {
    const list = $('#room-list');
    list.innerHTML = '';
    allRooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item' + (currentRoom && currentRoom.id === room.id ? ' active' : '');
        const icon = room.type === 'dm' ? '👤' : '💬';
        div.innerHTML = `
            <span class="room-icon">${icon}</span>
            <div class="room-info">
                <div class="room-name">${escHtml(room.name)}</div>
                <div class="room-desc">${escHtml(room.description || (room.type === 'dm' ? 'Личные сообщения' : 'Без описания'))}</div>
            </div>
        `;
        div.addEventListener('click', () => joinRoom(room.id));
        list.appendChild(div);
    });
}

function joinRoom(roomId) {
    socket.emit('join_room', roomId, (res) => {
        if (res.error) { alert(res.error); return; }
        currentRoom = res.room;
        renderRoomList();
        renderMessages(res.messages);
        renderOnlineUsers(res.onlineUsers || []);
        renderRoomMembers(res.members || []);
        $('#no-room').classList.add('hidden');
        $('#chat-container').classList.remove('hidden');
        $('#chat-room-name').textContent = currentRoom.name;
        $('#chat-room-desc').textContent = currentRoom.description || (currentRoom.type === 'dm' ? 'Личные сообщения' : '');

        // Show call button only in DM rooms with 1 other person
        const callBtn = $('#call-btn');
        if (currentRoom.type === 'dm') {
            callBtn.style.display = 'flex';
        } else {
            callBtn.style.display = 'none';
        }

        closeSidebar();
    });
}

socket.on('room_created', (room) => {
    if (!allRooms.find(r => r.id === room.id)) {
        allRooms.unshift(room);
        renderRoomList();
    }
});

// ===== USERS =====
function renderUserList() {
    const list = $('#user-list');
    list.innerHTML = '';
    allUsers.forEach(user => {
        if (user.id === currentUser.id) return;
        const div = document.createElement('div');
        div.className = 'user-item';
        const initial = user.nickname.charAt(0).toUpperCase();
        div.innerHTML = `
            <div class="user-avatar">
                ${initial}
                <span class="online-dot"></span>
            </div>
            <span class="user-item-name">${escHtml(user.nickname)}</span>
            <button class="btn-icon dm-btn" title="Написать в личку" data-user-id="${user.id}">💬</button>
        `;
        div.querySelector('.dm-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            startDM(user.id);
        });
        list.appendChild(div);
    });
    $('#online-count').textContent = allUsers.filter(u => u.id !== currentUser.id).length;
}

function startDM(targetUserId) {
    socket.emit('start_dm', targetUserId, (res) => {
        if (res.error) { alert(res.error); return; }
        if (!allRooms.find(r => r.id === res.room.id)) {
            allRooms.unshift(res.room);
        }
        renderRoomList();
        joinRoom(res.room.id);
    });
}

socket.on('user_list', (users) => {
    allUsers = users;
    renderUserList();
});

socket.on('online_users', (users) => {
    renderOnlineUsers(users);
});

function renderOnlineUsers(users) {
    const list = $('#user-list');
    list.innerHTML = '';
    const onlineUsers = users.filter(u => u.id !== currentUser.id);
    onlineUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        const initial = user.nickname.charAt(0).toUpperCase();
        div.innerHTML = `
            <div class="user-avatar">
                ${initial}
                <span class="online-dot"></span>
            </div>
            <span class="user-item-name">${escHtml(user.nickname)}</span>
            <button class="btn-icon dm-btn" title="Написать в личку" data-user-id="${user.id}">💬</button>
        `;
        div.querySelector('.dm-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            startDM(user.id);
        });
        list.appendChild(div);
    });
    $('#online-count').textContent = onlineUsers.length;
}

socket.on('user_joined', (data) => {
    if (currentRoom && currentRoom.id === data.room) {
        addSystemMessage(`${data.user.nickname} вошёл в комнату`);
    }
});

socket.on('user_left', (data) => {
    if (currentRoom && currentRoom.id === data.room) {
        addSystemMessage(`${data.user.nickname} вышел из комнаты`);
    }
});

// ===== INVITE =====
$('#invite-btn').addEventListener('click', () => {
    if (!currentRoom) return;
    const members = getRoomMembersInRoom();
    $('#invite-room-name').textContent = currentRoom.name;

    const list = $('#invite-user-list');
    list.innerHTML = '';
    allUsers.forEach(user => {
        if (user.id === currentUser.id) return;
        if (members.find(m => m.id === user.id)) return;

        const div = document.createElement('div');
        div.className = 'user-item';
        const initial = user.nickname.charAt(0).toUpperCase();
        div.innerHTML = `
            <div class="user-avatar">${initial}</div>
            <span class="user-item-name">${escHtml(user.nickname)}</span>
            <button class="btn-primary invite-user-btn" data-user-id="${user.id}" style="padding:0.3rem 0.8rem;font-size:0.8rem">Добавить</button>
        `;
        div.querySelector('.invite-user-btn').addEventListener('click', () => {
            socket.emit('invite_to_room', {
                roomId: currentRoom.id,
                userId: user.id
            }, (res) => {
                if (res.error) { alert(res.error); return; }
                div.remove();
                addSystemMessage(`${user.nickname} добавлен в комнату`);
            });
        });
        list.appendChild(div);
    });

    if (list.children.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem">Нет кого приглашать — все уже в комнате</p>';
    }

    $('#invite-modal').classList.remove('hidden');
});

$('#cancel-invite-btn').addEventListener('click', () => {
    $('#invite-modal').classList.add('hidden');
});

function getRoomMembersInRoom() {
    if (!currentRoom) return [];
    return allUsers.filter(u => {
        return true;
    });
}

// ===== MOBILE SIDEBAR =====
$('#menu-toggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
});

function closeSidebar() {
    $('#sidebar').classList.remove('open');
}

// ===== UTILS =====
function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addSystemMessage(text) {
    const messages = $('#messages');
    const div = document.createElement('div');
    div.className = 'message incoming';
    div.style.background = 'var(--bg-tertiary)';
    div.style.alignSelf = 'center';
    div.style.maxWidth = '90%';
    div.style.textAlign = 'center';
    div.style.color = 'var(--text-muted)';
    div.style.fontSize = '0.8rem';
    div.innerHTML = `<div class="msg-content">${escHtml(text)}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}
