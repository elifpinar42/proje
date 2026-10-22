 const activeWin = require('active-win');
    
     async function getActiveWindowInfo() {
         try {
             const info = await activeWin();
             if (info) {
                 return {
                     title: info.title,
                     owner: info.owner.name
                };
            }
        } catch (e) {
            console.error("Pencere bilgisi alınamadı:", e);
        }
        return { title: "Bilinmiyor", owner: "Bilinmiyor" };
    }
   
    module.exports = { getActiveWindowInfo };

   