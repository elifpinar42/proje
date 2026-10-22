// src/monitoring/keyboard.js
let GlobalKeyboardListener = null;
try {
    const gkl = require('node-global-key-listener') || require('global-key-listener');
    GlobalKeyboardListener = gkl.GlobalKeyboardListener || gkl;
} catch (e) {
    try {
        const gkl = require('global-key-listener');
        GlobalKeyboardListener = gkl.GlobalKeyboardListener || gkl;
    } catch (err) {}
}
const riskEngine = require('../core/riskEngine');

let keyboardInstance = null;
let keyPressTimes = [];

function startMonitoring() {
    if (!GlobalKeyboardListener) {
        console.log("[KLAVYE] Hafif tarayıcı içi etkileşim takibi devrede (Düşük RAM).");
        return;
    }
    
    try {
        keyboardInstance = new GlobalKeyboardListener();
        
        keyboardInstance.addListener((e) => {
            if (e.state === "DOWN") {
                keyPressTimes.push(Date.now());
            }
        });

        setInterval(() => {
            const now = Date.now();
            keyPressTimes = keyPressTimes.filter(time => now - time < 5000);
            const recentKeyPresses = keyPressTimes.length;
            
            let riskScore = 0;
            if (recentKeyPresses > 0) {
                riskScore = Math.min(100, Math.round((recentKeyPresses / 25) * 80));
            }

            riskEngine.updateState('keyboardRisk', riskScore);
        }, 2000);
    } catch (err) {
        console.warn("Klavye dinleyici başlatılamadı, tarayıcı modu kullanılacak:", err.message);
    }
}

module.exports = { startMonitoring };
