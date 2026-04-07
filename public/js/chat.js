// ===== MESSAGES =====
function renderMessages(messages) {
    const container = $('#messages');
    container.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    container.scrollTop = container.scrollHeight;
}

function appendMessage(msg) {
    const container = $('#messages');
    const isOut = currentUser && msg.user_id === currentUser.id;
    const div = document.createElement('div');
    div.className = `message ${isOut ? 'outgoing' : 'incoming'}`;

    let html = '';
    if (!isOut) {
        html += `<div class="msg-author">${escHtml(msg.nickname)}</div>`;
    }

    if (msg.type === 'text' && msg.content) {
        html += `<div class="msg-content">${formatText(msg.content)}</div>`;
    }

    if (msg.type === 'image' && msg.file_url) {
        html += `<div class="msg-file"><img src="${msg.file_url}" alt="${escHtml(msg.file_name || '')}" onclick="window.open(this.src)"></div>`;
        if (msg.content) html += `<div class="msg-content">${formatText(msg.content)}</div>`;
    }

    if (msg.type === 'file' && msg.file_url) {
        html += `<div class="msg-file"><a href="${msg.file_url}" download="${escHtml(msg.file_name || 'file')}">📄 ${escHtml(msg.file_name || 'Файл')}</a></div>`;
        if (msg.content) html += `<div class="msg-content">${formatText(msg.content)}</div>`;
    }

    if (msg.type === 'voice' && msg.file_url) {
        html += `<div class="msg-audio"><audio controls src="${msg.file_url}"></audio></div>`;
    }

    html += `<div class="msg-time">${formatTime(msg.created_at)}</div>`;

    div.innerHTML = html;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function formatText(text) {
    return escHtml(text)
        .replace(/\n/g, '<br>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

socket.on('new_message', (msg) => {
    if (currentRoom && msg.room_id === currentRoom.id) {
        appendMessage(msg);
    }
});

// ===== SEND MESSAGE =====
$('#send-btn').addEventListener('click', sendMessage);
$('#message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

let typingTimeout = null;
$('#message-input').addEventListener('input', () => {
    if (currentRoom) {
        socket.emit('typing');
    }
});

function sendMessage() {
    const input = $('#message-input');
    const content = input.value.trim();
    if (!content && pendingFiles.length === 0) return;
    if (!currentRoom) return;

    const filesToSend = [...pendingFiles];
    pendingFiles = [];
    renderFilePreview();

    if (filesToSend.length > 0) {
        filesToSend.forEach((fileData) => {
            socket.emit('send_message', {
                content: content,
                type: fileData.type,
                fileUrl: fileData.url,
                fileName: fileData.name,
                fileType: fileData.mimeType
            });
        });
    } else {
        socket.emit('send_message', { content, type: 'text' });
    }

    input.value = '';
    input.focus();
}

// ===== TYPING =====
let typingTimer = null;
socket.on('user_typing', (data) => {
    if (currentRoom && data.room === currentRoom.id) {
        const indicator = $('#typing-indicator');
        indicator.textContent = `${data.user} печатает...`;
        indicator.classList.remove('hidden');

        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            indicator.classList.add('hidden');
        }, 2000);
    }
});
