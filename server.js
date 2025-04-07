const express = require('express');
// const http = require('http'); // Artık http yerine https kullanacağız
const https = require('http'); // HTTPS modülünü dahil et
//const fs = require('fs');       // Dosya sistemini (sertifikaları okumak için) dahil et
const socketIo = require('socket.io');
const path = require('path');

const app = express();

// --- HTTPS Seçenekleri ---
// mkcert ile oluşturduğunuz sertifika ve anahtar dosyalarının yollarını belirtin
// Bu dosyaların server.js ile aynı klasörde olduğunu varsayıyoruz
/*const options = {
  key: fs.readFileSync('key.pem'),   // Özel anahtar dosyanız
  cert: fs.readFileSync('cert.pem')  // Sertifika dosyanız
};*/
// --- ---

// HTTPS sunucusunu oluşturun (Express app ve HTTPS seçenekleri ile)
const server = http.createServer(app);
// Socket.IO'yu HTTPS sunucusuna bağlayın
const io = socketIo(server);

// HTTPS için genellikle farklı bir port kullanılır (örn: 3001 veya 443)
// 443 standart HTTPS portudur ama bazen yönetici izni gerektirebilir.
// 3000 yerine 3001 kullanalım.
const PORT = process.env.PORT || 3001;

// Statik dosyaları sunmak için public klasörünü kullan (değişiklik yok)
app.use(express.static(path.join(__dirname, 'public')));

// Oda bilgilerini tutmak için basit bir yapı (değişiklik yok)
const rooms = {};

// Socket.IO bağlantı mantığı (değişiklik yok, aynen kalıyor)
io.on('connection', (socket) => {
    console.log('Yeni bir kullanıcı bağlandı (HTTPS):', socket.id);

    // --- Oda Yönetimi ---
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Kullanıcı ${socket.id}, ${roomId} odasına katıldı.`);
        if (!rooms[roomId]) {
            rooms[roomId] = new Set();
        }
        rooms[roomId].add(socket.id);
        socket.to(roomId).emit('user_joined', socket.id);
        const usersInRoom = Array.from(rooms[roomId]).filter(id => id !== socket.id);
        socket.emit('existing_users', usersInRoom);
        console.log(`${roomId} Odasındaki Kullanıcılar:`, Array.from(rooms[roomId]));
    });

    // --- WebRTC Sinyalleşme Mesajları ---
    socket.on('offer', (payload) => {
        console.log(`Offer gönderildi: ${socket.id} -> ${payload.targetUserId}`);
        io.to(payload.targetUserId).emit('offer_received', {
            signal: payload.signal,
            callerId: socket.id
        });
    });
    socket.on('answer', (payload) => {
        console.log(`Answer gönderildi: ${socket.id} -> ${payload.targetUserId}`);
        io.to(payload.targetUserId).emit('answer_received', {
            signal: payload.signal,
            responderId: socket.id
        });
    });
    socket.on('ice_candidate', (payload) => {
        // console.log(`ICE Candidate gönderildi: ${socket.id} -> ${payload.targetUserId}`);
        io.to(payload.targetUserId).emit('ice_candidate_received', {
            candidate: payload.candidate,
            senderId: socket.id
        });
    });

    // --- Bağlantı Kesilmesi ---
    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı:', socket.id);
        for (const roomId in rooms) {
            if (rooms[roomId].has(socket.id)) {
                rooms[roomId].delete(socket.id);
                console.log(`Kullanıcı ${socket.id}, ${roomId} odasından ayrıldı.`);
                socket.to(roomId).emit('user_left', socket.id);
                if (rooms[roomId].size === 0) {
                    delete rooms[roomId];
                    console.log(`Oda ${roomId} boşaldı ve silindi.`);
                } else {
                     console.log(`${roomId} Odasındaki Kullanıcılar:`, Array.from(rooms[roomId]));
                }
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    // Çalışma mesajını da güncelleyelim
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});