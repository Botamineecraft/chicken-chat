// ===== FILE HANDLING =====
let pendingFiles = [];

$('#attach-btn').addEventListener('click', () => {
    $('#file-input').click();
});

$('#file-input').addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
});

// Drag & Drop
const chatArea = $('#chat-area');

chatArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatArea.style.outline = '2px dashed var(--accent)';
});

chatArea.addEventListener('dragleave', () => {
    chatArea.style.outline = '';
});

chatArea.addEventListener('drop', (e) => {
    e.preventDefault();
    chatArea.style.outline = '';
    if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
    }
});

async function handleFiles(fileList) {
    for (const file of fileList) {
        if (file.size > 10 * 1024 * 1024) {
            alert(`Файл "${file.name}" слишком большой (макс 10MB)`);
            continue;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.url) {
                const fileType = file.type.startsWith('image/') ? 'image' : 'file';
                pendingFiles.push({
                    url: data.url,
                    name: data.name,
                    type: fileType,
                    mimeType: data.type
                });
                renderFilePreview();
            }
        } catch (err) {
            console.error('Ошибка загрузки файла:', err);
            alert('Ошибка загрузки файла');
        }
    }
}

function renderFilePreview() {
    const container = $('#file-preview');
    container.innerHTML = '';

    if (pendingFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    pendingFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-preview-item';

        if (file.type === 'image') {
            div.innerHTML = `
                <img src="${file.url}" alt="${escHtml(file.name)}">
                <div class="file-name">${escHtml(file.name)}</div>
            `;
        } else {
            div.innerHTML = `
                <div style="padding:0.5rem;text-align:center;font-size:1.5rem;">📄</div>
                <div class="file-name">${escHtml(file.name)}</div>
            `;
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-preview-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
            pendingFiles.splice(index, 1);
            renderFilePreview();
        });

        div.appendChild(removeBtn);
        container.appendChild(div);
    });
}
