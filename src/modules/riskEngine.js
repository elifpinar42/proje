// src/modules/riskEngine.js
     let riskScore = 0;
    
     function updateRisk(moduleName, factor) {
         // Burada modüllerden gelen veriye göre puanı güncelleyeceğiz
         // Basit bir puanlama mantığı:
         if (factor === 'stress') riskScore += 20;
         if (factor === 'calm') riskScore -= 10;
    
        if (riskScore > 100) riskScore = 100;
        if (riskScore < 0) riskScore = 0;
   
        console.log(`Güncel Risk Puanı: ${riskScore} (Tetikleyen: ${moduleName})`);
        return riskScore;
    }
   
    module.exports = { updateRisk };