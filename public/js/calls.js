// ===== WEBRTC VOICE/VIDEO CALLS + SCREEN SHARE =====
let localStream = null;
let screenStream = null;
let peerConnection = null;
let callTimerInterval = null;
let callSeconds = 0;
let isMuted = false;
let isCameraOff = true;
let isScreenSharing = false;
let currentCallUserId = null;
let isInCall = false;
let callType = 'audio';

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

$('#call-btn').addEventListener('click', () => {
    if (!currentRoom || currentRoom.type !== 'dm') return;
    const members = getRoomMembersFromMsgs();
    const targetUser = members.find(u => u.id !== currentUser.id);
    if (!targetUser) return;

    // Спрашиваем тип звонка
    callType = 'audio';
    startCall(targetUser.id, targetUser.nickname, 'audio');
});

$('#call-btn').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!currentRoom || currentRoom.type !== 'dm') return;
    const members = getRoomMembersFromMsgs();
    const targetUser = members.find(u => u.id !== currentUser.id);
    if (!targetUser) return;
    callType = 'video';
    startCall(targetUser.id, targetUser.nickname, 'video');
});

$('#call-end-btn').addEventListener('click', endCall);
$('#call-mute-btn').addEventListener('click', toggleMute);
$('#call-camera-btn').addEventListener('click', toggleCamera);
$('#call-screen-btn').addEventListener('click', toggleScreenShare);
$('#call-accept-audio').addEventListener('click', () => acceptCall('audio'));
$('#call-accept-video').addEventListener('click', () => acceptCall('video'));
$('#call-decline-btn').addEventListener('click', declineCall);

socket.on('call_incoming', (data) => {
    if (isInCall) return;
    currentCallUserId = data.from;
    callType = data.callType || 'audio';
    $('#incoming-name').textContent = data.fromName;
    $('#incoming-avatar').textContent = data.fromName.charAt(0).toUpperCase();
    $('#incoming-call-modal').classList.remove('hidden');
});

socket.on('call_signal', async (data) => {
    if (!peerConnection) return;
    try {
        if (data.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('call_signal', {
                userId: currentCallUserId,
                type: 'answer',
                data: answer
            });
        } else if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
        } else if (data.type === 'ice-candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.data));
        }
    } catch (err) {
        console.error('WebRTC signal error:', err);
    }
});

socket.on('call_rejected', () => {
    endCallUI();
    addSystemMessage('Звонок отклонён');
});

socket.on('call_ended', () => {
    endCallUI();
    addSystemMessage('Звонок завершён');
});

async function startCall(userId, userName, type) {
    if (isInCall) return;
    currentCallUserId = userId;
    isInCall = true;
    callType = type;

    try {
        if (type === 'video') {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
        } else {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } catch (err) {
        alert('Нет доступа к микрофону!');
        isInCall = false;
        return;
    }

    if (type === 'video') {
        isCameraOff = false;
        $('#local-video').srcObject = localStream;
    } else {
        isCameraOff = true;
    }

    $('#call-name').textContent = userName;
    $('#call-avatar').textContent = userName.charAt(0).toUpperCase();
    $('#call-status-text').textContent = type === 'video' ? 'Видеозвонок...' : 'Вызов...';
    $('#call-timer').textContent = '00:00';
    $('#call-modal').classList.remove('hidden');
    isMuted = false;
    isScreenSharing = false;
    $('#call-mute-btn').classList.remove('muted');
    $('#call-mute-btn').textContent = '🎤';
    $('#call-camera-btn').classList.toggle('muted', !isCameraOff);
    $('#call-camera-btn').textContent = isCameraOff ? '📷' : '📹';
    $('#call-screen-btn').classList.remove('muted');
    $('#call-screen-btn').textContent = '🖥';

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        const remoteVideo = $('#remote-video');
        remoteVideo.srcObject = event.streams[0];
        if (event.streams[0].getVideoTracks().length > 0) {
            $('.call-video-area').classList.add('active');
            $('#call-avatar').style.display = 'none';
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('call_signal', {
                userId: currentCallUserId,
                type: 'ice-candidate',
                data: event.candidate
            });
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('call_signal', {
                userId: currentCallUserId,
                type: 'offer',
                data: offer
            });
        } catch (err) {
            console.error('Renegotiation error:', err);
        }
    };

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call_signal', {
            userId: currentCallUserId,
            type: 'offer',
            data: offer
        });

        socket.emit('call_start', { userId, callType: type }, (res) => {
            if (res.error) {
                endCall();
                alert(res.error);
            }
        });
    } catch (err) {
        console.error('Error creating offer:', err);
        endCall();
    }
}

async function acceptCall(type) {
    $('#incoming-call-modal').classList.add('hidden');
    isInCall = true;
    callType = type;

    try {
        if (type === 'video') {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
            isCameraOff = false;
            $('#local-video').srcObject = localStream;
        } else {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isCameraOff = true;
        }
    } catch (err) {
        alert('Нет доступа к микрофону!');
        isInCall = false;
        return;
    }

    const userName = $('#incoming-name').textContent;
    $('#call-name').textContent = userName;
    $('#call-avatar').textContent = userName.charAt(0).toUpperCase();
    $('#call-status-text').textContent = 'Разговор';
    $('#call-timer').textContent = '00:00';
    $('#call-modal').classList.remove('hidden');
    isMuted = false;
    isScreenSharing = false;
    $('#call-mute-btn').classList.remove('muted');
    $('#call-mute-btn').textContent = '🎤';
    $('#call-camera-btn').classList.toggle('muted', !isCameraOff);
    $('#call-camera-btn').textContent = isCameraOff ? '📷' : '📹';
    $('#call-screen-btn').classList.remove('muted');
    $('#call-screen-btn').textContent = '🖥';

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        const remoteVideo = $('#remote-video');
        remoteVideo.srcObject = event.streams[0];
        if (event.streams[0].getVideoTracks().length > 0) {
            $('.call-video-area').classList.add('active');
            $('#call-avatar').style.display = 'none';
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('call_signal', {
                userId: currentCallUserId,
                type: 'ice-candidate',
                data: event.candidate
            });
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('call_signal', {
                userId: currentCallUserId,
                type: 'offer',
                data: offer
            });
        } catch (err) {
            console.error('Renegotiation error:', err);
        }
    };

    startCallTimer();
    addSystemMessage('Звонок начался');
}

function declineCall() {
    $('#incoming-call-modal').classList.add('hidden');
    if (currentCallUserId) {
        socket.emit('call_reject', { userId: currentCallUserId });
    }
    currentCallUserId = null;
}

function endCall() {
    if (currentCallUserId) {
        socket.emit('call_end', { userId: currentCallUserId });
    }
    endCallUI();
}

function endCallUI() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    stopCallTimer();
    isInCall = false;
    currentCallUserId = null;
    isCameraOff = true;
    isScreenSharing = false;
    $('#call-modal').classList.add('hidden');
    $('#incoming-call-modal').classList.add('hidden');
    $('.call-video-area').classList.remove('active');
    $('#call-avatar').style.display = '';
    $('#remote-video').srcObject = null;
    $('#local-video').srcObject = null;
    addSystemMessage('Звонок завершён');
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    $('#call-mute-btn').classList.toggle('muted', isMuted);
    $('#call-mute-btn').textContent = isMuted ? '🔇' : '🎤';
}

async function toggleCamera() {
    if (!localStream) return;

    if (isCameraOff) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            const videoTrack = videoStream.getVideoTracks()[0];

            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');

            if (videoSender) {
                videoSender.replaceTrack(videoTrack);
            } else {
                peerConnection.addTrack(videoTrack, videoStream);
            }

            localStream.addTrack(videoTrack);
            $('#local-video').srcObject = localStream;
            isCameraOff = false;
            $('#call-camera-btn').textContent = '📹';
            $('#call-camera-btn').classList.remove('muted');
        } catch (err) {
            alert('Нет доступа к камере!');
        }
    } else {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);

            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                peerConnection.removeTrack(videoSender);
            }

            $('#local-video').srcObject = localStream;
            isCameraOff = true;
            $('#call-camera-btn').textContent = '📷';
            $('#call-camera-btn').classList.add('muted');
        }
    }
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const screenTrack = screenStream.getVideoTracks()[0];

            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');

            if (videoSender) {
                videoSender.replaceTrack(screenTrack);
            } else {
                peerConnection.addTrack(screenTrack, screenStream);
            }

            screenTrack.onended = () => {
                stopScreenShare();
            };

            isScreenSharing = true;
            $('#call-screen-btn').classList.add('muted');
            $('#call-screen-btn').textContent = '⏹';
            addSystemMessage('Демонстрация экрана включена');
        } catch (err) {
            console.log('Screen share cancelled');
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }

    if (localStream && !isCameraOff) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(videoTrack);
            }
        }
    } else {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
            peerConnection.removeTrack(videoSender);
        }
    }

    isScreenSharing = false;
    $('#call-screen-btn').classList.remove('muted');
    $('#call-screen-btn').textContent = '🖥';
    addSystemMessage('Демонстрация экрана выключена');
}

function startCallTimer() {
    callSeconds = 0;
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const min = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const sec = String(callSeconds % 60).padStart(2, '0');
        $('#call-timer').textContent = `${min}:${sec}`;
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callSeconds = 0;
}

function getRoomMembersFromMsgs() {
    return allUsers;
}
