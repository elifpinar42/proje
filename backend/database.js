const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const usersPath = path.join(dataDir, 'users.json');
const settingsPath = path.join(dataDir, 'settings.json');
const reportsPath = path.join(dataDir, 'reports.json');
const historyPath = path.join(dataDir, 'history.json');
const activitiesPath = path.join(dataDir, 'activities.json');
const summariesPath = path.join(dataDir, 'daily_summaries.json');
const aiChatsPath = path.join(dataDir, 'ai_chats.json');

// Klasörleri ve dosyaları oluştur
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function initFile(filePath, defaultData = []) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    }
}

initFile(usersPath, []);
initFile(settingsPath, {
    sensitivity: 'medium', // 'low', 'medium', 'high'
    cameraEnabled: false, // Donanım gizlilik ilkesi (varsayılan kapalı)
    micEnabled: false,
    screenEnabled: true,
    keyboardEnabled: true,
    notifyParentOnRisk: true
});
initFile(reportsPath, []);
initFile(historyPath, []);
initFile(activitiesPath, []);
initFile(summariesPath, []);
initFile(aiChatsPath, []);

function readFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function writeFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const usersDB = {
    insert: (user, callback) => {
        try {
            const data = readFile(usersPath) || [];
            data.push(user);
            writeFile(usersPath, data);
            if (callback) callback(null, user);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    findOne: (query, callback) => {
        try {
            const data = readFile(usersPath) || [];
            const user = data.find(u => u.username === query.username);
            if (callback) callback(null, user);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    update: (query, updateQuery, options, callback) => {
        try {
            let data = readFile(usersPath) || [];
            const index = data.findIndex(u => u.username === query.username);
            if (index !== -1) {
                if (updateQuery.$set) {
                    data[index] = { ...data[index], ...updateQuery.$set };
                }
                writeFile(usersPath, data);
                if (callback) return callback(null, 1);
            }
            if (callback) callback(null, 0);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

const settingsDB = {
    get: (callback) => {
        try {
            const settings = readFile(settingsPath) || {};
            if (callback) callback(null, settings);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    update: (newSettings, callback) => {
        try {
            const current = readFile(settingsPath) || {};
            const updated = { ...current, ...newSettings };
            writeFile(settingsPath, updated);
            if (callback) callback(null, updated);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

const reportsDB = {
    add: (report, callback) => {
        try {
            const reports = readFile(reportsPath) || [];
            const newReport = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                ...report
            };
            reports.unshift(newReport);
            if (reports.length > 100) reports.length = 100;
            writeFile(reportsPath, reports);
            
            // Aynı zamanda kalıcı silinmeyen geçmiş kaydına da ekle
            historyDB.add(newReport);

            if (callback) callback(null, newReport);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    getAll: (callback) => {
        try {
            const reports = readFile(reportsPath) || [];
            if (callback) callback(null, reports);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

// KALICI VE SİLİNMEYEN GEÇMİŞ AKTİVİTE & RİSK VERİTABANI
const historyDB = {
    add: (entry, callback) => {
        try {
            const history = readFile(historyPath) || [];
            const newEntry = {
                id: entry.id || Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4),
                timestamp: entry.timestamp || new Date().toISOString(),
                childUsername: entry.childUsername || 'çocuk',
                title: entry.title || 'Aktarım Kaydı',
                details: entry.details || '',
                score: entry.score || 0,
                category: entry.category || 'Genel Risk',
                windowTitle: entry.windowTitle || 'Bilinmiyor',
                emotion: entry.emotion || 'neutral',
                emotionLabel: entry.emotionLabel || 'Nötr / Gözlemsel',
                action: entry.action || 'Sistem Kaydı',
                aiObservation: entry.aiObservation || 'Görsel ve metinsel veriler analiz edildi.',
                parentTip: entry.parentTip || 'Çocuğunuzla dijital alışkanlıkları üzerine sohbet edin.'
            };
            history.unshift(newEntry);
            writeFile(historyPath, history);
            if (callback) callback(null, newEntry);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    getFiltered: (options = {}, callback) => {
        try {
            let history = readFile(historyPath) || [];
            const { startDate, endDate, minScore, category } = options;

            if (startDate) {
                const start = new Date(startDate).getTime();
                history = history.filter(item => new Date(item.timestamp).getTime() >= start);
            }
            if (endDate) {
                const end = new Date(endDate).getTime();
                history = history.filter(item => new Date(item.timestamp).getTime() <= end);
            }
            if (minScore !== undefined) {
                history = history.filter(item => item.score >= Number(minScore));
            }
            if (category && category !== 'all') {
                history = history.filter(item => item.category === category);
            }

            if (callback) callback(null, history);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

// UYGULAMA / SİTE KULLANIM SÜRELERİ VERİTABANI
const activityDB = {
    add: (act, callback) => {
        try {
            const activities = readFile(activitiesPath) || [];
            const newAct = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                appName: act.appName || 'Bilinmiyor',
                durationSeconds: act.durationSeconds || 60,
                category: act.category || 'Genel Kullanım'
            };
            activities.unshift(newAct);
            if (activities.length > 500) activities.length = 500;
            writeFile(activitiesPath, activities);
            if (callback) callback(null, newAct);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    getAll: (callback) => {
        try {
            const acts = readFile(activitiesPath) || [];
            if (callback) callback(null, acts);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

// ÇOCUK REHBER YAPAY ZEKÂ SOHBET KAYITLARI
const aiChatDB = {
    add: (chat, callback) => {
        try {
            const chats = readFile(aiChatsPath) || [];
            const newChat = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                question: chat.question,
                response: chat.response,
                safetyFlag: chat.safetyFlag || false
            };
            chats.unshift(newChat);
            if (chats.length > 200) chats.length = 200;
            writeFile(aiChatsPath, chats);
            if (callback) callback(null, newChat);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    getAll: (callback) => {
        try {
            const chats = readFile(aiChatsPath) || [];
            if (callback) callback(null, chats);
        } catch (err) {
            if (callback) callback(err);
        }
    }
};

// İPTAL EDİLMİŞ TOKEN'LAR (REVOKED TOKENS BLACKLIST)
const revokedTokensPath = path.join(dataDir, 'revoked_tokens.json');
const sessionsPath = path.join(dataDir, 'active_sessions.json');
const securityLogsPath = path.join(dataDir, 'security_logs.json');

initFile(revokedTokensPath, []);
initFile(sessionsPath, []);
initFile(securityLogsPath, []);

function isTokenRevoked(token) {
    try {
        const tokens = readFile(revokedTokensPath) || [];
        return tokens.some(t => t.token === token);
    } catch (e) {
        return false;
    }
}

function revokeToken(token, username) {
    try {
        const tokens = readFile(revokedTokensPath) || [];
        tokens.push({ token, username, revokedAt: new Date().toISOString() });
        // 30 günden eski iptal kayıtlarını temizle
        if (tokens.length > 500) tokens.shift();
        writeFile(revokedTokensPath, tokens);
    } catch (e) {}
}

const sessionsDB = {
    addSession: (sessionData) => {
        try {
            const sessions = readFile(sessionsPath) || [];
            sessions.unshift({
                id: sessionData.sessionId || Date.now().toString(),
                username: sessionData.username,
                token: sessionData.token,
                device: sessionData.device || 'Bilinmeyen Cihaz / Web',
                ip: sessionData.ip || '127.0.0.1',
                loginTime: new Date().toISOString(),
                lastActive: new Date().toISOString()
            });
            if (sessions.length > 100) sessions.length = 100;
            writeFile(sessionsPath, sessions);
        } catch (e) {}
    },
    getUserSessions: (username) => {
        try {
            const sessions = readFile(sessionsPath) || [];
            return sessions.filter(s => s.username === username);
        } catch (e) {
            return [];
        }
    },
    removeSession: (sessionId, username) => {
        try {
            let sessions = readFile(sessionsPath) || [];
            const target = sessions.find(s => s.id === sessionId && s.username === username);
            if (target && target.token) {
                revokeToken(target.token, username);
            }
            sessions = sessions.filter(s => !(s.id === sessionId && s.username === username));
            writeFile(sessionsPath, sessions);
        } catch (e) {}
    },
    removeAllUserSessions: (username) => {
        try {
            let sessions = readFile(sessionsPath) || [];
            sessions.forEach(s => {
                if (s.username === username && s.token) revokeToken(s.token, username);
            });
            sessions = sessions.filter(s => s.username !== username);
            writeFile(sessionsPath, sessions);
        } catch (e) {}
    }
};

const securityLogsDB = {
    logEvent: (event) => {
        try {
            const logs = readFile(securityLogsPath) || [];
            logs.unshift({
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                type: event.type, // 'SUCCESSFUL_LOGIN', 'FAILED_LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'UNAUTHORIZED_ACCESS'
                username: event.username || 'Anonim',
                ip: event.ip || '127.0.0.1',
                details: event.details || ''
            });
            if (logs.length > 300) logs.length = 300;
            writeFile(securityLogsPath, logs);
        } catch (e) {}
    },
    getLogs: (limit = 50) => {
        try {
            const logs = readFile(securityLogsPath) || [];
            return logs.slice(0, limit);
        } catch (e) {
            return [];
        }
    }
};

// VERİ SAKLAMA VE SİLME (RETENTION & PURGE MEKANİZMASI)
const dataRetentionDB = {
    purgeOldData: (daysLimit = 30) => {
        try {
            const cutoffTime = Date.now() - (daysLimit * 24 * 60 * 60 * 1000);
            
            // Ham ses/ekran ve anlık logları temizle
            let reports = readFile(reportsPath) || [];
            reports = reports.filter(r => new Date(r.timestamp).getTime() >= cutoffTime);
            writeFile(reportsPath, reports);

            let activities = readFile(activitiesPath) || [];
            activities = activities.filter(a => new Date(a.timestamp).getTime() >= cutoffTime);
            writeFile(activitiesPath, activities);

            console.log(`[VERİ SİLME/RETENTION] ${daysLimit} günden eski geçici aktiviteler otomatik temizlendi.`);
        } catch (e) {
            console.error("Veri silme retention hatası:", e.message);
        }
    }
};

// REFRESH TOKEN ROTATION VE REUSE DETECTION VERİTABANI
const refreshTokensPath = path.join(dataDir, 'refresh_tokens.json');
initFile(refreshTokensPath, []);

const refreshTokensDB = {
    addRefreshToken: (username, refreshToken, familyId) => {
        try {
            const tokens = readFile(refreshTokensPath) || [];
            tokens.unshift({
                id: Date.now().toString(),
                username,
                token: refreshToken,
                familyId: familyId || Date.now().toString(),
                used: false,
                createdAt: new Date().toISOString()
            });
            if (tokens.length > 300) tokens.length = 300;
            writeFile(refreshTokensPath, tokens);
        } catch (e) {}
    },
    verifyAndRotate: (username, inputRefreshToken) => {
        try {
            const tokens = readFile(refreshTokensPath) || [];
            const tokenRecord = tokens.find(t => t.username === username && t.token === inputRefreshToken);
            
            if (!tokenRecord) {
                return { valid: false, reason: 'NOT_FOUND' };
            }

            // REUSE DETECTION: Kullanılmış token tekrar sunulursa Güvenlik Uyarısı ve tüm oturumları kapatma!
            if (tokenRecord.used) {
                console.warn(`[GÜVENLİK İHLALİ] Kullanılmış Refresh Token Tekrar Kullanılmaya Çalışıldı! (${username})`);
                // Aynı aileye ait tüm token'ları iptal et ve tüm oturumları sonlandır
                const updatedTokens = tokens.filter(t => t.username !== username);
                writeFile(refreshTokensPath, updatedTokens);
                sessionsDB.removeAllUserSessions(username);
                securityLogsDB.logEvent({ 
                    type: 'TOKEN_REUSE_DETECTED', 
                    username, 
                    details: 'İptal edilen refresh token tekrar sunuldu. Tüm oturumlar güvenlik için kapatıldı.' 
                });
                return { valid: false, reason: 'REUSE_DETECTED' };
            }

            // Token'ı kullanıldı olarak işaretle (Rotation)
            tokenRecord.used = true;
            writeFile(refreshTokensPath, tokens);
            return { valid: true, familyId: tokenRecord.familyId };
        } catch (e) {
            return { valid: false, reason: 'ERROR' };
        }
    },
    revokeUserRefreshTokens: (username) => {
        try {
            let tokens = readFile(refreshTokensPath) || [];
            tokens = tokens.filter(t => t.username !== username);
            writeFile(refreshTokensPath, tokens);
        } catch (e) {}
    }
};

module.exports = { 
    usersDB, 
    settingsDB, 
    reportsDB, 
    historyDB, 
    activityDB, 
    aiChatDB,
    isTokenRevoked,
    revokeToken,
    sessionsDB,
    securityLogsDB,
    dataRetentionDB,
    refreshTokensDB
};


