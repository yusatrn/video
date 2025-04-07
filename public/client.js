const socket = io();

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const joinButton = document.getElementById('joinButton');
const roomIdInput = document.getElementById('roomId');
const muteAudioButton = document.getElementById('muteAudioButton');
const stopVideoButton = document.getElementById('stopVideoButton');

let localStream;
let roomId;
// Peer bağlantılarını takip etmek için (anahtar: diğer kullanıcının socketId'si)
let peerConnections = {};
// STUN sunucu yapılandırması (Google'ın public sunucuları)
const peerConnectionConfig = {
    iceServers: [
        // Sadece Google'ın ücretsiz STUN sunucuları kalsın
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
        // TURN sunucusu girdilerini buraya EKLEMİYORUZ (bedava yöntem)
    ]
};

// --- Yardımcı Fonksiyonlar (Kısaltılmış) ---
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Kamera/mikrofon erişimi hatası:', error);
        alert('Kamera ve mikrofon erişimi gerekli.');
    }
}

function createPeerConnection(targetUserId) {
    console.log(`Peer connection oluşturuluyor -> ${targetUserId}`);
    const pc = new RTCPeerConnection(peerConnectionConfig);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`ICE Candidate gönderiliyor -> ${targetUserId}`);
            socket.emit('ice_candidate', {
                targetUserId: targetUserId,
                candidate: event.candidate,
                roomId: roomId // Oda bilgisi eklenebilir (sunucu tarafında kontrol için)
            });
        }
    };

    pc.ontrack = (event) => {
        console.log(`Uzak track alındı <- ${targetUserId}`);
        addRemoteStream(event.streams[0], targetUserId);
    };

    // Yerel stream'deki track'leri bağlantıya ekle
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
        console.log("Yerel track'ler eklendi.");
    } else {
        console.warn("Yerel stream henüz hazır değilken peer connection oluşturuldu!");
    }


    peerConnections[targetUserId] = pc;
    return pc;
}

function addRemoteStream(stream, userId) {
    let videoElement = document.getElementById(`video-${userId}`);
    if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.id = `video-${userId}`;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        const userDiv = document.createElement('div');
        userDiv.id = `user-${userId}`;
        userDiv.appendChild(document.createTextNode(`Kullanıcı: ${userId.substring(0, 6)}`));
        userDiv.appendChild(videoElement);
        remoteVideos.appendChild(userDiv);
    }
    videoElement.srcObject = stream;
}

function removeRemoteUser(userId) {
    console.log(`Kullanıcı kaldırılıyor: ${userId}`);
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    const userDiv = document.getElementById(`user-${userId}`);
    if (userDiv) {
        userDiv.remove();
    }
}

// --- Socket.IO Olay Dinleyicileri ---

socket.on('connect', () => {
    console.log('Sinyalleşme sunucusuna bağlandı:', socket.id);
});

// Başka bir kullanıcı odaya katıldığında tetiklenir
socket.on('user_joined', async (userId) => {
    console.log('Yeni kullanıcı katıldı:', userId);
    // Yeni katılan kullanıcıya bağlantı teklifi (offer) gönder
    const pc = createPeerConnection(userId);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`Offer gönderiliyor -> ${userId}`);
        socket.emit('offer', {
            targetUserId: userId,
            signal: offer,
            roomId: roomId
        });
    } catch (error) {
        console.error("Offer oluşturma/gönderme hatası:", error);
    }
});

// Başka bir kullanıcıdan offer alındığında
socket.on('offer_received', async (payload) => {
    const { signal: offer, callerId } = payload;
    console.log(`Offer alındı <- ${callerId}`);
    const pc = createPeerConnection(callerId); // Bağlantıyı oluştur
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer)); // Gelen offer'ı ayarla
        const answer = await pc.createAnswer(); // Cevap oluştur
        await pc.setLocalDescription(answer); // Cevabı yerel olarak ayarla
        console.log(`Answer gönderiliyor -> ${callerId}`);
        socket.emit('answer', { // Cevabı gönderene geri yolla
            targetUserId: callerId,
            signal: answer,
            roomId: roomId
        });
    } catch (error) {
        console.error("Offer işleme/answer oluşturma hatası:", error);
    }
});

// Gönderdiğimiz offer'a cevap geldiğinde
socket.on('answer_received', async (payload) => {
    const { signal: answer, responderId } = payload;
    console.log(`Answer alındı <- ${responderId}`);
    const pc = peerConnections[responderId];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer)); // Gelen cevabı ayarla
            console.log(`Peer connection ${responderId} ile kuruldu (ICE bekleniyor).`);
        } catch (error) {
            console.error("Answer işleme hatası:", error);
        }
    } else {
        console.warn(`Answer alındı ama ${responderId} için peer connection bulunamadı.`);
    }
});

// Başka bir kullanıcıdan ICE adayı geldiğinde
socket.on('ice_candidate_received', async (payload) => {
    const { candidate, senderId } = payload;
    // console.log(`ICE Candidate alındı <- ${senderId}`);
    const pc = peerConnections[senderId];
    if (pc && candidate) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)); // Adayı bağlantıya ekle
        } catch (error) {
            console.error('ICE adayı ekleme hatası:', error);
        }
    } else if (!pc) {
         console.warn(`ICE adayı alındı ama ${senderId} için peer connection bulunamadı.`);
    }
});

// Bir kullanıcı odadan ayrıldığında
socket.on('user_left', (userId) => {
    console.log('Kullanıcı ayrıldı:', userId);
    removeRemoteUser(userId);
});

// Odaya katıldığımızda mevcut kullanıcıların listesi (isteğe bağlı)
socket.on('existing_users', (users) => {
    console.log('Odadaki mevcut kullanıcılar:', users);
    // Bu kullanıcılarla da bağlantı kurmak için offer gönderebilirsiniz
    // (user_joined ile benzer mantık)
});


// --- Buton Olayları ---
joinButton.onclick = async () => {
    roomId = roomIdInput.value.trim();
    if (!roomId) {
        alert('Lütfen bir oda ID girin.');
        return;
    }
    if (!localStream) {
        await startLocalStream(); // Önce yerel yayını başlat
    }
    if (localStream) {
        socket.emit('join_room', roomId); // Sunucuya katılma isteği gönder
        joinButton.disabled = true;
        roomIdInput.disabled = true;
        console.log(`${roomId} odasına katılma isteği gönderildi.`);
    } else {
        alert("Yerel medya akışı başlatılamadı.")
    }
};

// Ses açma/kapama
muteAudioButton.onclick = () => {
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    audioTracks.forEach(track => {
        track.enabled = !track.enabled;
    });
    muteAudioButton.textContent = audioTracks[0].enabled ? 'Sesi Kapat' : 'Sesi Aç';
};

// Video açma/kapama
stopVideoButton.onclick = () => {
     if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;

    videoTracks.forEach(track => {
        track.enabled = !track.enabled;
    });
    stopVideoButton.textContent = videoTracks[0].enabled ? 'Videoyu Durdur' : 'Videoyu Başlat';
};

// Başlangıçta yerel stream'i başlatmaya çalış (isteğe bağlı)
// startLocalStream();