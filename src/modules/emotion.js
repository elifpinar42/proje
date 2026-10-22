// Görüntü işleme modülü
     const faceapi = require('face-api.js');
    
     async function loadModels() {
         await Promise.all([
    
      faceapi.nets.tinyFaceDetector.loadFromUri('https://raw.githubusercontent.com/justadudewhohac
      ks/face-api.js/master/weights'),
    
      faceapi.nets.faceExpressionNet.loadFromUri('https://raw.githubusercontent.com/justadudewhoha
      cks/face-api.js/master/weights')
         ]);
         console.log("Duygu analizi modelleri yüklendi.");
    }
   
    async function analyzeEmotion(videoElement) {
        const detections = await faceapi.detectAllFaces(videoElement, new
      faceapi.TinyFaceDetectorOptions())
            .withFaceExpressions();
   
        if (detections.length > 0) {
            const expressions = detections[0].expressions;
            return Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a
      : b);
        }
        return 'neutral';
    }
   
    module.exports = { loadModels, analyzeEmotion };
