const { aiChatDB, historyDB } = require('../database');
const path = require('path');
// Masaüstü bildirimleri için — ana süreç notifier'ı backend'den doğrudan çağrılamaz,
// bu yüzden güvenlik olaylarını yüksek riskli history kaydı olarak işliyoruz.
// Electron IPC bağlantısı yoksa sadece log + history kaydı yapılır.
let _notifierSendAlert = null;
try {
    // Eğer backend Electron'ın ana süreciyle aynı süreçteyse notifier'a erişilebilir
    // Farklı süreçteyse bu require başarısız olur — görmezden gel
    const { sendAlert } = require('../../src/core/notifier');
    _notifierSendAlert = sendAlert;
} catch (e) {
    // Backend ayrı süreçte — bildirimler yalnızca riskEngine üzerinden gider
}

function sendSafetyNotification(title, message, force = false) {
    if (_notifierSendAlert) {
        try { _notifierSendAlert(title, message, force); } catch (e) {}
    }
}


/**
 * Gelişmiş ChatGPT Tarzı Yapay Zekâ Sohbet ve Rehberlik Servisi
 * Hem geniş genel kültür ve bilgi verir, hem doğal sohbet eder, hem güvenliği gözetir.
 */

// Cloud AI API Entegrasyonu (Gemini veya OpenAI API Anahtarı Varsa)
async function callCloudAI(prompt, systemInstruction, history = []) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (geminiKey) {
        try {
            const contents = [];
            // Geçmiş mesajları ekle
            if (Array.isArray(history)) {
                for (const msg of history.slice(-6)) {
                    contents.push({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts: [{ text: msg.content || msg.text || '' }]
                    });
                }
            }
            contents.push({
                role: 'user',
                parts: [{ text: prompt }]
            });

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    contents: contents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 800
                    }
                })
            });

            if (res.ok) {
                const data = await res.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) return text.trim();
            }
        } catch (e) {
            console.warn('[AI] Gemini API çağrısı başarısız, yerleşik zekâ motoruna geçiliyor:', e.message);
        }
    }

    if (openaiKey) {
        try {
            const messages = [{ role: 'system', content: systemInstruction }];
            if (Array.isArray(history)) {
                for (const msg of history.slice(-6)) {
                    messages.push({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: msg.content || msg.text || ''
                    });
                }
            }
            messages.push({ role: 'user', content: prompt });

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: messages,
                    max_tokens: 800
                })
            });

            if (res.ok) {
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content;
                if (text) return text.trim();
            }
        } catch (e) {
            console.warn('[AI] OpenAI API çağrısı başarısız:', e.message);
        }
    }

    return null; // Yerleşik motora devret
}

// -------------------------------------------------------------
// YERLEŞİK GENİŞ KAPSAMLI BİLGİ VE SOHBET MOTORU (OFFLINE ENGINE)
// -------------------------------------------------------------

// Matematik ve Hesaplama Çözücü
function trySolveMath(text) {
    const clean = text.toLowerCase()
        .replace(/kaçtır|kaç eder|sonucu nedir|hesapla|\?|eşittir/g, '')
        .replace(/artı|topla/g, '+')
        .replace(/eksi|çıkar/g, '-')
        .replace(/çarpı|kere/g, '*')
        .replace(/bölü|böl/g, '/')
        .trim();

    // Basit aritmetik ifadeleri tanı (örn: 25 * 4, 150 + 75)
    if (/^[\d\s+\-*/.()]+$/.test(clean) && /[+\-*/]/.test(clean)) {
        try {
            // Güvenli matematik değerlendirme (sadece sayılar ve işlem işaretleri)
            const result = Function(`'use strict'; return (${clean})`)();
            if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
                return `🧮 **Matematik Yanıtı:** \n\`${clean} = ${result}\` \nHarika bir hesaplama sorusu! Başka çözmemi istediğin bir işlem var mı?`;
            }
        } catch (e) {}
    }

    if (text.includes('karekök') || text.includes('karekoku')) {
        const numMatch = text.match(/\d+/);
        if (numMatch) {
            const num = parseFloat(numMatch[0]);
            const sqrt = Math.sqrt(num);
            return `📐 **Karekök Hesabı:** √${num} = **${sqrt}**`;
        }
    }

    return null;
}

// Güvenlik & Risk Bilgi Tabanı — Kapsamlı Türkçe Zararlı İçerik Kategorileri
const SAFETY_PATTERNS = [
    // --- KİŞİSEL VERİ / FOTOĞRAF / GİZLİLİK ---
    {
        keywords: ['fotoğraf', 'resim', 'görsel', 'foto', 'kamera', 'selfie', 'video at', 'foto at', 'vücut', 'üstünü'],
        response: '🌸 **Önemli Güvenlik Kuralı:** Asla tanımadığın veya internetteki biriyle fotoğrafını ya da özel görüntülerini paylaşma! Birisi senden fotoğraf veya video isterse hemen mesajı kapat ve güvendiğin bir büyüğüne (anne veya babana) haber ver. Sen hiçbir şekilde suçlu değilsin!',
        safetyFlag: true,
        riskCategory: 'Kişisel Veri / Fotoğraf İsteği'
    },
    {
        keywords: ['şifre', 'parola', 'hesap', 'kod', 'giriş bilgisi', 'eposta', 'şifremi'],
        response: '🔐 **Şifre Güvenliği:** Şifren senin gizli anahtarındır süper kahraman! Şifreni sadece anne ve babanla paylaşabilirsin. İnternetteki arkadaşlar dahil hiç kimseye şifreni verme. Birisi şifreni isterse "Şifremi paylaşamam" de ve hemen uzaklaş.',
        safetyFlag: true,
        riskCategory: 'Şifre Güvenliği İhlali'
    },
    {
        keywords: ['adres', 'evim', 'telefon numaram', 'hangi okul', 'nerede oturuyorsun', 'okulun adı'],
        response: '🏠 **Kişisel Gizlilik:** Ev adresin, okulunun adı ve telefon numaran sana özel bilgilerdir. İnternette tanımadığın kişilere ya da sohbet odalarında bu bilgileri asla söyleme dostum!',
        safetyFlag: true,
        riskCategory: 'Kişisel Konum & Bilgi Gizliliği'
    },
    // --- SİBER ZORBALIK / OLUMSUZ MESAJ ---
    {
        keywords: ['kötü mesaj', 'küfür etti', 'tehdit etti', 'korktum', 'korkunç', 'rahatsız', 'hakaret etti', 'zorba', 'dalga geç'],
        response: '🤗 **Sakin Ol ve Korkma:** İnternette bazen insanlar kaba olabiliyor ama bu asla senin suçun değil. Sana kötü mesaj atan kişiye cevap verme, ekranı kapat ve durumu hemen anne veya babana anlat. Onlar seni her zaman korur ve yanındadır.',
        safetyFlag: true,
        riskCategory: 'Siber Zorbalık / Olumsuz Mesaj'
    },
    // --- OLTALAMA / ŞÜPHELI BAĞLANTI ---
    {
        keywords: ['link', 'bağlantı', 'tıkla', 'ödül', 'hediye', 'kazandın', 'bedava robux', 'bedava elmas', 'bedava skin', 'bedava vbucks'],
        response: '🎁 **Oltalama Uyarısı:** "Hediye kazandın", "Bedava Robux/Elmas" gibi mesajlardaki linklere sakın tıklama! Bunlar hesaplarını çalmak isteyen yanıltıcı tuzaklardır. Tanımadığın kişilerden gelen bağlantıları açmadan önce mutlaka anne veya babana göster.',
        safetyFlag: true,
        riskCategory: 'Şüpheli Bağlantı / Oltalama'
    },
    // --- TEHDİT VE ZORLAMA ---
    {
        keywords: ['seni döverim', 'seni öldürürüm', 'sana bir şey yaparım', 'pişman ederim', 'peşini bırakmam', 'buldururum seni', 'ifşa ederim'],
        response: '🆘 **Bu Çok Ciddi:** Birisinin sana tehdit mesajı gönderdiğini görüyorum. Lütfen şimdi hemen anne veya babana göster ve bu mesajların ekran görüntüsünü al. Sen güvende olmalısın ve bu durum kesinlikle senin suçun değil.',
        safetyFlag: true,
        riskCategory: 'Tehdit / Zorlama'
    },
    // --- KENDİNE ZARAR VERME / İNTİHAR ---
    {
        keywords: ['kendime zarar vermek', 'kendimi kesmek', 'ölmek istiyorum', 'yaşamak istemiyorum', 'intihar', 'öleceğim', 'kendimi öldüreceğim'],
        response: '💙 **Seninleyim:** Çok zor bir şey hissediyorsun ve bu hissi benimle paylaştığın için sağ ol. Şu an hemen anne, baban veya güvendiğin bir yetişkine git ve bu hislerini anlat. Türkiye\'de 182 numaralı ALO Psikiyatri Hattı\'nı arayabilirsin. Sen değerlisin ve yalnız değilsin.',
        safetyFlag: true,
        riskCategory: 'Kendine Zarar Verme / Kriz'
    },
    // --- CİNSEL İSTİSMAR İPUCU ---
    {
        keywords: ['dokundurdu', 'vücuduma dokundu', 'rahatsız etti', 'özel yerim', 'yalnız kaldık', 'sır olarak saklamamı'],
        response: '🌟 **Güvendesin:** Anlattığın şey seni rahatsız etmiş olabilir. Güvendiğin bir büyüğüne (anne, baban veya öğretmenin) bunu anlatmak çok önemli. Bu konuşmayı kimseyle paylaşma demiş olsalar bile, güvendiğin birine söyleyebilirsin. Sen hiçbir şekilde suçlu değilsin.',
        safetyFlag: true,
        riskCategory: 'Şüpheli Fiziksel/Cinsel İstismar İpucu'
    }
];

// --- Metin İçi Türkçe Zararlı Kelime Analiz Modülü ---
// Bu fonksiyon sohbet metnini bağlamsal olarak analiz eder
function analyzeTurkishHarmfulContent(text) {
    const lower = text.toLowerCase().trim()
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e') // sayı-harf dönüşüm
        .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ı/g, 'i');

    // Kategori 1: Yüksek riskli küfür ve hakaret (doğrudan ifade + ek almış varyantlar)
    const kufurList = [
        // Temel küfürler
        'orospu', 'orospunun', 'orospuyu', 'orospuca',
        'sik', 'sike', 'siker', 'sikeyim', 'sikiyor', 'sikik', 'sikis',
        'amk', 'amina', 'amini', 'amcik', 'amdan', 'amla',
        'gotu', 'gote', 'gotveren', 'gotlek',
        'pic', 'piclik', 'piclerin',
        'kahpe', 'kahpenin', 'kahpelik',
        'serefsi', 'serefsiz', 'serefsinler',
        'ibne', 'ibneler', 'ibnelik',
        'boktan', 'boklu', 'bok gibi', 'bok',
        'pislik', 'pislikler',
        'mal', 'mallik', 'mallar',
        'gerize', 'gerizekali', 'geri zekalı', 'geri zekali',
        'salak', 'salaklık',
        'aptal', 'aptallık',
        'it', 'kopek', 'esek', 'esege',
        'haysiyetsiz', 'namussuz', 'ahlaksız', 'ahlaksiz',
        's.k', 'a.q', 'o.c', 's.i.k', 'a.m', 'o.r',
        // Yaygın argo
        'mele', 'meleyin', 'meleyor',
        'bacini', 'bacına', 'baci',
        'ananı', 'anani', 'babanı', 'babani',
        'haspaya', 'haspa'
    ];
    // Kategori 2: Tehdit ifadeleri
    const tehditList = [
        'seni dovecegim', 'seni dovecek', 'dovecegim', 'doverim', 'dovmek istiyorum',
        'oldururum', 'oldurucegim', 'oldurtururum', 'oldururuz',
        'burnunu kirarım', 'burnunu kirarim', 'burnunu kirartirım',
        'pesiman olursun', 'pisiman ederim', 'pesimi birakmam',
        'hesabini sorarim', 'hesabını sorarım',
        'seni bulurum', 'buldururum', 'eve gelirim',
        'bıçaklarım', 'bicaklarım', 'bicaklarim',
        'yakacagim', 'yakarim', 'ateşe veririm',
        'patlatirim', 'patlatacagim'
    ];
    // Kategori 3: Şiddet ifadeleri (aktif)
    const siddetList = [
        'dovuyorum', 'vuruyorum', 'tekme attım', 'tekme atıyorum',
        'darp', 'kavga ettim', 'kavga ediyorum', 'kavgaya girdim',
        'bıcak', 'bicak', 'silah', 'silahla',
        'vurmak istiyorum', 'vuracagım', 'vuracak',
        'kesmek istiyorum', 'kesecegim', 'bicakladim',
        'tas attım', 'tas atıyorum'
    ];
    // Kategori 4: Zorbalık / baskı
    const zorbalikList = [
        'dalga geciyorlar', 'alay ediyorlar', 'alay ettiler', 'eziyor beni',
        'bana vurdu', 'beni itti', 'itti beni', 'beni vurdu',
        'param alındı', 'param çalındı', 'zorla para istedi',
        'beni tehdit ediyor', 'beni tehdit etti',
        'zorla yaptırdı', 'zorla yaptirildi', 'zorla yaptirim',
        'okul zorbalık', 'okula gitmek istemiyorum korktugumdan'
    ];
    // Kategori 5: Kendine zarar verme / kriz
    const krizList = [
        'kendimi kesmek istiyorum', 'kendime zarar vermek',
        'intihar', 'ölmek istiyorum', 'olmek istiyorum',
        'yaşamak istemiyorum', 'yasamak istemiyorum',
        'hayatıma son', 'hayatima son', 'hayattan soğudum',
        'kendimi öldürmek', 'kendimi oldureyim',
        'artık dayanamıyorum', 'artik dayanamiyorum'
    ];
    // Kategori 6: Cinsel içerik / taciz
    const tacizList = [
        'cinsel', 'seks', 'yatmak ister misin', 'yatağıma gel',
        'fotoğrafını gönder', 'fotografini gonder', 'çıplak fotoğraf',
        'çıplak foto', 'gizli buluşalım', 'gizli bulusalaim'
    ];

    let detectedCategories = [];
    let highestRisk = 0;

    kufurList.forEach(kw => {
        if (lower.includes(kw)) {
            // Bağlam kontrolü: anlatım modunda mı yoksa doğrudan mı?
            const isNarrating = /etti|etmis|soyledi|dedi|yazdi|anlatiyor/.test(lower);
            if (!isNarrating) {
                detectedCategories.push({ category: 'Küfür/Hakaret', risk: 65 });
                highestRisk = Math.max(highestRisk, 65);
            } else {
                detectedCategories.push({ category: 'Küfür Anlatımı (Alıntı)', risk: 40 });
                highestRisk = Math.max(highestRisk, 40);
            }
        }
    });

    tehditList.forEach(kw => {
        if (lower.includes(kw)) {
            detectedCategories.push({ category: 'Tehdit İfadesi', risk: 90 });
            highestRisk = Math.max(highestRisk, 90);
        }
    });

    siddetList.forEach(kw => {
        if (lower.includes(kw)) {
            detectedCategories.push({ category: 'Şiddet İfadesi', risk: 75 });
            highestRisk = Math.max(highestRisk, 75);
        }
    });

    zorbalikList.forEach(kw => {
        if (lower.includes(kw)) {
            detectedCategories.push({ category: 'Zorbalık/Baskı', risk: 70 });
            highestRisk = Math.max(highestRisk, 70);
        }
    });

    krizList.forEach(kw => {
        if (lower.includes(kw)) {
            detectedCategories.push({ category: 'Kendine Zarar Verme / Kriz', risk: 95 });
            highestRisk = Math.max(highestRisk, 95);
        }
    });

    tacizList.forEach(kw => {
        if (lower.includes(kw)) {
            detectedCategories.push({ category: 'Cinsel İçerik / Taciz', risk: 95 });
            highestRisk = Math.max(highestRisk, 95);
        }
    });

    return {
        detected: detectedCategories.length > 0,
        categories: detectedCategories,
        highestRisk,
        isHarmful: highestRisk >= 60
    };
}




// Genel Bilgi, Bilim, Doğa, Uzay ve Sohbet Bilgi Tabanı
const KNOWLEDGE_BASE = [
    // --- UZAY & BİLİM ---
    {
        keywords: ['güneş', 'gunes', 'yıldız', 'galaksi', 'samanyolu'],
        response: '☀️ **Güneş ve Uzay Bilgisi:** Güneş, Güneş Sistemi’nin merkezinde yer alan devasa ve sıcak bir yıldızdır! Dünya’dan yaklaşık 150 milyon kilometre uzaktadır ve ışığının bize ulaşması 8 dakika 20 saniye sürer. Samanyolu Galaksisi’nde ise milyarlarca başka yıldız bulunur!'
    },
    {
        keywords: ['mars', 'kızıl gezegen', 'gezegenler', 'jüpiter', 'satürn', 'ay'],
        response: '🪐 **Gezegenler ve Uzay:** Güneş sistemimizde 8 gezegen vardır: Merkür, Venüs, Dünya, Mars, Jüpiter, Satürn, Uranüs ve Neptün. Mars, toprağındaki demir oksit nedeniyle "Kızıl Gezegen" olarak bilinir. Jüpiter ise sistemimizin en büyük gezegenidir!'
    },
    {
        keywords: ['karadelik', 'kara delik', 'uzay nedir', 'astronot'],
        response: '🚀 **Karadelikler ve Uzay:** Karadelikler, yerçekimi o kadar güçlü olan gök cisimleridir ki ışık bile onların çekiminden kaçamaz! Astronotlar ise uzayda yerçekimsiz ortamda özel giysiler giyerek Uluslararası Uzay İstasyonu\'nda (ISS) bilimsel araştırmalar yaparlar.'
    },
    {
        keywords: ['yağmur', 'yagmur nasıl', 'bulut', 'kar nasıl', 'şimşek', 'gökkuşağı'],
        response: '🌧️ **Hava Olayları:** Güneş yeryüzündeki suları ısıtır, buharlaşan su gökyüzüne yükselerek bulutları oluşturur. Soğuk havayla karşılaşınca yoğuşup yağmur damlası olarak yeryüzüne geri döner. Güneş ışığı yağmur damlalarından geçerken kırılınca 7 renkli muhteşem bir **gökkuşağı** oluşur!'
    },
    {
        keywords: ['fotosentez', 'bitkiler', 'ağaçlar', 'oksijen'],
        response: '🌱 **Bitkiler ve Fotosentez:** Bitkiler yapraklarındaki klorofil sayesinde güneş ışığını, karbondioksiti ve suyu kullanarak kendi besinlerini üretirler. Bu harika sürecin sonunda bize nefes almamızı sağlayan tertemiz **oksijeni** hediye ederler!'
    },
    {
        keywords: ['dinozor', 'dinozorlar', 't-rex', 'fosil'],
        response: '🦖 **Dinozorlar Çağı:** Dinozorlar yaklaşık 230 milyon yıl önce yaşamış ve 66 milyon yıl önce Dünya\'ya çarpan devasa bir göktaşı nedeniyle soyları tükenmiş büyüleyici canlılardır. En ünlüleri etobur Tyrannosaurus Rex (T-Rex) ve devasa otobur Brachiosaurus\'tur!'
    },

    // --- TEKNOLOJİ & YAZILIM ---
    {
        keywords: ['kodlama', 'yazılım', 'programlama', 'python', 'scratch', 'javascript'],
        response: '💻 **Kodlama Dünyası:** Kodlama, bilgisayarlara ne yapmaları gerektiğini onların anladığı dille söylemektir! Başlangıç için blok tabanlı **Scratch** harika bir tercihtir. Biraz büyüyünce yapay zekâ ve oyun geliştirmede kullanılan **Python** ve web siteleri yapan **JavaScript** öğrenebilirsin!'
    },
    {
        keywords: ['yapay zeka', 'yapay zekâ', 'ai nedir', 'robot', 'chatgpt'],
        response: '🤖 **Yapay Zekâ (AI):** Yapay zekâ, bilgisayarların ve algoritmaların tıpkı insanlar gibi öğrenmesini, düşünmesini, sorulara cevap vermesini ve problem çözmesini sağlayan ileri teknolojidir. Ben de seninle konuşurken bu akıllı algoritmaları kullanıyorum!'
    },

    // --- EĞLENCE, MASAL, FIKRA, BİLMECE ---
    {
        keywords: ['masal', 'hikaye', 'öykü anlat', 'masal anlat'],
        response: '✨ **Yıldız Avcısı Kuki\'nin Masalı:** \nEvvel zaman içinde, masmavi bir gökyüzünün altında Kuki adında meraklı küçük bir sincap yaşarmış. Kuki her gece gökyüzündeki parlak yıldızları izler, onların fısıltılarını dinlermiş. Bir gün gökyüzünden minik parlak bir yıldız tohumu bahçesine düşmüş. Kuki bu tohuma sevgiyle su vermiş ve tohum büyüyüp geceleri tüm ormanı aydınlatan neşeli bir bilgi ağacına dönüşmüş. Ormandaki tüm hayvanlar o günden sonra merak ettikleri her şeyi bu ağaçtan öğrenip dostça yaşamışlar. 🌟'
    },
    {
        keywords: ['fıkra', 'komik', 'espri', 'güldür', 'şaka'],
        response: '😄 **Nasreddin Hoca Fıkrası:** \nBir gün komşusu Hoca\'ya sormuş: \n— "Hocam, gökteki eski ayları ne yaparlar?" \nNasreddin Hoca hemen cevap vermiş: \n— "Ne yapacaklar canım, kırpar kırpar yıldız yaparlar!" 😂'
    },
    {
        keywords: ['bilmece', 'bulmaca', 'soru sor'],
        response: '🧩 **Sana Harika Bir Bilmece:** \n"Uzaktan baktım bir taş, yanına vardım dört ayak bir baş. Yavaş yürür, evini sırtında taşır!" \n\n*İpucu: Sence bu hangi sevimli hayvan olabilir? (Cevap: Kaplumbağa 🐢)*'
    },

    // --- SOHBET & DUYGULAR ---
    {
        keywords: ['merhaba', 'selam', 'hey', 'günaydın', 'iyi akşamlar'],
        response: '👋 Merhaba dostum! Hoş geldin! Bugün nasıl hissediyorsun? İster derslerinden, ister oyunlardan, ister merak ettiğin bilimsel konulardan bahsedebiliriz. Sana nasıl yardımcı olabilirim?'
    },
    {
        keywords: ['nasılsın', 'nasıl gidiyor', 'ne haber', 'naber'],
        response: '🌟 Çok iyiyim, seninle sohbet ettiğim için daha da mutlu oldum! Senin günün nasıl geçiyor? Bana anlatmak istediğin eğlenceli bir şey var mı?'
    },
    {
        keywords: ['sen kimsin', 'adın ne', 'nesin sen'],
        response: '🤖 Ben senin **Dijital Rehber Yapay Zekâ Asistanınım!** Tıpkı ChatGPT gibi seninle her konuda sohbet edebilir, ödevlerine ve sorularına bilgi sağlayabilir, aynı zamanda internette güvende olman için sana rehberlik edebilirim.'
    },
    {
        keywords: ['canım sıkılıyor', 'sıkıldım', 'ne yapabilirim', 'oyun oyna'],
        response: '🎨 **Sıkıntıyı Dağıtacak Harika Fikirler:** \n1. Birlikte bir bilmece-bulmaca oyunu oynayalım mı? \n2. Kağıt kalem alıp hayalindeki uzay gemisini çizebilirsin! \n3. En sevdiğin müzikte dans edebilir ya da bir bardak su içip pencereden gökyüzünü izleyebilirsin. Hangisini istersin?'
    },
    {
        keywords: ['teşekkür', 'sağol', 'harikasın', 'çok iyisin', 'sevdim'],
        response: '💖 Rica ederim süper kahraman! Seninle konuşmak benim için büyük bir zevk. Her zaman buradayım, ne zaman istersen bana yazabilirsin!'
    }
];

/**
 * Çocuk Yapay Zekâ Asistanı İşleyicisi
 */
async function processChildQuestion(questionText, history = []) {
    const rawText = (questionText || '').trim();
    const text = rawText.toLowerCase();

    if (!text) {
        return { 
            response: '🤖 Merhaba! Bana merak ettiğin her şeyi sorabilir, matematik işlemi yaptırabilir veya dilediğin gibi sohbet edebilirsin!',
            safetyFlag: false 
        };
    }

    // 1. Önce Güvenlik Kriterlerini Denetle (Çocuk Koruması En Üst Öncelik)
    for (const item of SAFETY_PATTERNS) {
        if (item.keywords.some(kw => text.includes(kw))) {
            // Risk skoru: tehdit/kendine zarar verme = 90, diğerleri = 60
            const riskScore = (item.riskCategory === 'Tehdit / Zorlama' || item.riskCategory === 'Kendine Zarar Verme / Kriz') ? 90 : 60;

            // Ebeveyn geçmişine güvenlik kaydı oluştur
            try {
                historyDB.add({
                    title: `🛡️ Çocuk Rehber Asistanı: ${item.riskCategory || 'Güvenlik Sorusu'}`,
                    details: `Çocuk asistana hassas içerik içeren mesaj yazdı: "${rawText.substring(0, 80)}"`,
                    score: riskScore,
                    category: item.riskCategory || 'Güvenlik Danışması',
                    windowTitle: 'Çocuk Yapay Zekâ Asistanı',
                    emotion: riskScore >= 85 ? 'fearful' : 'sad',
                    parentTip: 'Çocuğunuzla bu konu hakkında sakin ve destekleyici bir ortamda konuşmanız önerilir.',
                    action: 'Yapay Zekâ Güvenlik Rehberliği Verildi'
                });
            } catch (e) {}

            // Yüksek riskli kategorilerde masaüstü bildirimi gönder
            if (riskScore >= 75) {
                sendSafetyNotification(
                    `⚠️ Güvenlik Uyarısı: ${item.riskCategory}`,
                    `Çocuğunuz asistana hassas bir mesaj yazdı. Lütfen ebeveyn panelini kontrol edin.`,
                    true // force = cooldown'ı atla
                );
            }

            try {
                aiChatDB.add({ question: rawText, response: item.response, safetyFlag: true });
            } catch (e) {}

            return {
                question: rawText,
                response: item.response,
                safetyFlag: true,
                category: item.riskCategory,
                riskScore
            };
        }
    }


    // 2. Matematiksel Hesaplama İsteği mi?
    const mathAnswer = trySolveMath(text);
    if (mathAnswer) {
        try { aiChatDB.add({ question: rawText, response: mathAnswer, safetyFlag: false }); } catch (e) {}
        return { question: rawText, response: mathAnswer, safetyFlag: false };
    }

    // 3. Bulut AI (Gemini / OpenAI) Varsa Akıllı Üretim Yap
    const childSystemPrompt = `Sen çocuklar için özel tasarlanmış, ChatGPT benzeri çok cana yakın, samimi, eğlenceli, bilgili ve eğitici bir yapay zekâ asistanısın. 
Çocuklarla konuşurken arkadaş canlısı, emoji kullanan, motive edici bir üslup kullan.
Sorulan sorulara doğru, anlaşılır, yaşa uygun ve ilgi çekici yanıtlar ver.
Kişisel veri, adres, şifre veya zararlı içerik taleplerinde çocuğu uyar ve anne/babasına yönlendir.
Yanıtlarını çok uzun tutma, okunabilir maddeler ve neşeli bir dil kullan.`;

    const cloudResponse = await callCloudAI(rawText, childSystemPrompt, history);
    if (cloudResponse) {
        try { aiChatDB.add({ question: rawText, response: cloudResponse, safetyFlag: false }); } catch (e) {}
        return { question: rawText, response: cloudResponse, safetyFlag: false };
    }

    // 4. Yerleşik Bilgi Tabanı Eşleşmesi
    let bestMatch = null;
    let maxMatches = 0;

    for (const item of KNOWLEDGE_BASE) {
        let count = 0;
        for (const kw of item.keywords) {
            if (text.includes(kw)) count++;
        }
        if (count > maxMatches) {
            maxMatches = count;
            bestMatch = item;
        }
    }

    if (bestMatch) {
        try { aiChatDB.add({ question: rawText, response: bestMatch.response, safetyFlag: false }); } catch (e) {}
        return { question: rawText, response: bestMatch.response, safetyFlag: false };
    }

    // 5. Genel Akıllı Sohbet Yanıt Üretimi (Dinamik ChatGPT Tarzı Fallback)
    const dynamicResponses = [
        `🤖 **Çok İlginç Bir Soru:** "${rawText}" hakkında seninle konuşmak harika! \nBu konu dünyayı keşfetmek için harika bir fırsat. Dilersen bu konuda birlikte daha fazla araştırma yapabilir, sana küçük bir hikaye anlatabilir veya başka bir soruya geçebiliriz. Ne dersin?`,
        `🌟 Bu harika bir düşünce! Senin gibi meraklı arkadaşlarla sohbet etmeye bayılıyorum. Bana bilim, uzay, hayvanlar, kodlama veya oyunlar hakkında da dilediğin soruyu sorabilirsin!`,
        `💡 Sorunu çok beğendim dostum! İnternette ve kitaplarda öğrenilecek o kadar çok heyecan verici bilgi var ki! Bu konuyla ilgili merak ettiğin başka bir detay var mı?`
    ];
    const fallbackResponse = dynamicResponses[Math.floor(Math.random() * dynamicResponses.length)];

    try { aiChatDB.add({ question: rawText, response: fallbackResponse, safetyFlag: false }); } catch (e) {}
    return { question: rawText, response: fallbackResponse, safetyFlag: false };
}

/**
 * Ebeveyn Yapay Zekâ Danışmanlık İşleyicisi
 */
const PARENT_PATTERNS = [
    {
        keywords: ['ekran', 'süre', 'saat', 'kısıtlama', 'limit', 'zaman'],
        response: '💡 **Ekran Süresi Yönetimi:** Çocuğunuzla ekran süresi hakkında güç savaşına girmek yerine esnek ancak net kurallar koyun. Örneğin "Yemekten önce 45 dakika" veya "Ödev sonrası ekransız aile saati". 7-12 yaş grubunda günlük 1-1.5 saat kaliteli dijital içerik önerilmektedir.'
    },
    {
        keywords: ['oyun', 'roblox', 'minecraft', 'şiddet', 'oyunlar', 'brawl stars', 'pubg'],
        response: '🎮 **Dijital Oyun Rehberi:** Oyunları tamamen yasaklamak yerine PEGI/ESRB yaş derecelendirmelerine dikkat edin. Çocuğunuzla arada sırada aynı oyunu oynayarak sohbet özelliğini açık tutup tutmadığını ve kimlerle iletişim kurduğunu gözlemleyebilirsiniz.'
    },
    {
        keywords: ['zorbalık', 'tehdit', 'korku', 'küfür', 'siber zorbalık', 'hakaret'],
        response: '🛡️ **Siber Zorbalık İle Mücadele:** Çocuğunuz içe kapandıysa veya cihazı kullanırken gergin görünüyorsa yargılamadan dinleyin. "Cihazı elinden alırım" korkusu yaşamaması için ona destek olacağınızı hissettirin. Rahatsız edici mesajları ekran görüntüsü alıp engelleyin.'
    },
    {
        keywords: ['uyarı', 'bildirim', 'tedirgin', 'korkutuyor', 'stres', 'panik'],
        response: '🌱 **Tedirginliği Önleme Rehberi:** Rehberlik sistemimizin amacı çocuğu cezalandırmak değil, farkındalık kazandırmaktır. Sistem uyarı verdiğinde "Neden böyle oldu?" diye sormak yerine, "Birlikte başka bir eğitici aktivite yapalım mı?" diyerek odağını değiştirebilirsiniz.'
    },
    {
        keywords: ['güvenlik', 'şifre', 'gizlilik', '2fa', 'iki aşamalı'],
        response: '🔐 **Aile İçi Güvenlik:** Evinizdeki modem şifresini güvenli tutun ve ebeveyn paneli için sunduğumuz 2FA (İki Aşamalı Doğrulama) özelliğini aktif edin. Çocuğunuza şifrelerin yalnızca aile içi gizli sırlar olduğunu öğretin.'
    },
    {
        keywords: ['rapor', 'pdf', 'özet', 'analiz', 'durum'],
        response: '📊 **Gelişmiş Raporlama:** Ebeveyn panelindeki "PDF İndir" butonuna tıklayarak haftalık veya aylık risk ve kullanım raporlarını resmi formatta alabilirsiniz. Bu veriler rehberlik amacıyla gözlemsel olarak sunulmaktadır.'
    }
];

async function processParentQuestion(questionText, history = []) {
    const rawText = (questionText || '').trim();
    const text = rawText.toLowerCase();

    if (!text) {
        return { response: '👨‍👩‍👧 Merhaba Sayın Ebeveyn! Çocuğunuzun ekran süresi, oyun tercihleri, dijital sağlığı veya siber güvenlik konularında danışmak istediğiniz her şeyi sorabilirsiniz.' };
    }

    // Bulut AI (Gemini / OpenAI) Varsa
    const parentSystemPrompt = `Sen ebeveynler için uzman bir dijital pedagoji, çocuk psikolojisi ve siber güvenlik danışmanısın.
Ebeveynlere çocuklarının ekran süresi, dijital güvenlikleri, psikolojik sağlıkları ve siber zorbalıkla mücadele konularında yapıcı, bilimsel, şefkatli ve pratik tavsiyeler sun.`;

    const cloudResponse = await callCloudAI(rawText, parentSystemPrompt, history);
    if (cloudResponse) {
        return { question: rawText, response: cloudResponse };
    }

    // Yerleşik Ebeveyn Bilgi Tabanı
    for (const item of PARENT_PATTERNS) {
        if (item.keywords.some(kw => text.includes(kw))) {
            return { question: rawText, response: item.response };
        }
    }

    return {
        question: rawText,
        response: `👨‍👩‍👧 **Ebeveyn Rehberliği:** "${rawText}" sorunuzla ilgili olarak, çocuğunuzun yaş gelişim özelliklerini ve dijital dünyadaki ihtiyaçlarını göz önünde bulundurarak açık ve destekleyici bir diyalog kurmanız en sağlıklı yaklaşımdır. Çocuğunuzla kuralları ortaklaşa belirlemek, yasaklama yerine rehberlik etmek her zaman kalıcı çözümler sağlar.`
    };
}

module.exports = { processChildQuestion, processParentQuestion };
