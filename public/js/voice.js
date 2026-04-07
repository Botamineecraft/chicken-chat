// ===== VOICE MESSAGES =====
let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let isRecording = false;
let analyser = null;
let animFrame = null;

$('#voice-btn').addEventListener('click', () => {
    $('#voice-modal').classList.remove('hidden');
    resetVoiceRecorder();
});

$('#voice-cancel-btn').addEventListener('click', () => {
    stopRecording();
    $('#voice-modal').classList.add('hidden');
    resetVoiceRecorder();
});

$('#voice-record-btn').addEventListener('click', async () => {
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
});

$('#voice-send-btn').addEventListener('click', () => {
    if (!audioBlob || !currentRoom) return;

    const formData = new FormData();
    formData.append('file', audioBlob, 'voice.ogg');

    fetch('/api/upload', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.url) {
                socket.emit('send_message', {
                    content: '',
                    type: 'voice',
                    fileUrl: data.url,
                    fileName: 'voice.ogg',
                    fileType: 'audio/ogg'
                });
            }
        })
        .catch(err => console.error('Ошибка загрузки:', err));

    $('#voice-modal').classList.add('hidden');
    resetVoiceRecorder();
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: 'audio/ogg' });
            $('#voice-send-btn').disabled = false;
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        $('#voice-record-btn').textContent = '⏹ Стоп';
        $('#voice-record-btn').classList.add('recording');
        $('#voice-send-btn').disabled = true;

        setupVisualizer(stream);
    } catch (err) {
        alert('Нет доступа к микрофону!');
        console.error(err);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    $('#voice-record-btn').textContent = '⏺ Записать';
    $('#voice-record-btn').classList.remove('recording');
    if (animFrame) cancelAnimationFrame(animFrame);
}

function resetVoiceRecorder() {
    audioChunks = [];
    audioBlob = null;
    isRecording = false;
    $('#voice-record-btn').textContent = '⏺ Записать';
    $('#voice-record-btn').classList.remove('recording');
    $('#voice-send-btn').disabled = true;
    if (animFrame) cancelAnimationFrame(animFrame);
}

function setupVisualizer(stream) {
    const canvas = $('#voice-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        animFrame = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = '#1c2733';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
            const hue = (i / bufferLength) * 120 + 200;
            ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
        }
    }

    draw();
}
