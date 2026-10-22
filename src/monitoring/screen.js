// src/monitoring/screen.js
const { getActiveWindowInfo } = require('../modules/windowMonitor');
const riskEngine = require('../core/riskEngine');

// Yüksek riskli sakıncalı kategoriler (Kumar, yetişkin içerik, aşırı şiddet/silah)
const highRiskKeywords = ['kumar', 'bahis', 'casino', 'yetişkin', 'porno', 'canlı bahis', 'silah satın al', 'dehşet şiddet', 'cinayet kan'];
const mediumRiskKeywords = ['bıçak', 'kavga', 'korkunç', 'tehlikeli oyun'];
let lastTitle = "";

async function monitorScreen() {
    setInterval(async () => {
        try {
            const winInfo = await getActiveWindowInfo();
            if (!winInfo) return;
            const rawTitle = winInfo.title || '';
            const currentTitle = `${rawTitle} ${winInfo.owner || ''}`.toLowerCase();
            
            if (currentTitle === lastTitle) return;
            lastTitle = currentTitle;

            let riskScore = 0;
            if (highRiskKeywords.some(keyword => currentTitle.includes(keyword))) {
                riskScore = 85;
            } else if (mediumRiskKeywords.some(keyword => currentTitle.includes(keyword))) {
                riskScore = 45;
            }

            riskEngine.updateState({
                windowRisk: riskScore,
                windowTitle: rawTitle || winInfo.owner || 'Bilinmiyor'
            });
        } catch (e) {
            // Sessiz hafif mod
        }
    }, 4000);
}

module.exports = { monitorScreen };


