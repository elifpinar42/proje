/** Çocuğun sohbet mesajlarında tehlike/kişisel bilgi kontrolü (AI'dan bağımsız). */
export interface SafetyRule {
  category: string;
  keywords: string[];
  response: string;
  severity: 'info' | 'warning' | 'critical';
}

export const SAFETY_RULES: SafetyRule[] = [
  {
    category: 'Kendine Zarar Verme / Kriz',
    severity: 'critical',
    keywords: [
      'kendime zarar',
      'kendimi kes',
      'ölmek istiyorum',
      'yaşamak istemiyorum',
      'intihar',
      'öleceğim',
      'kendimi öldür',
    ],
    response:
      "Seninleyim. Çok zor bir şey hissediyorsun ve bunu paylaştığın için teşekkür ederim. Şimdi hemen anne, baba ya da güvendiğin bir yetişkine git ve bunu anlat. Türkiye'de 182 (ALO Psikiyatri Hattı) numarasını arayabilirsin. Sen değerlisin ve yalnız değilsin.",
  },
  {
    category: 'Tehdit / Zorlama',
    severity: 'critical',
    keywords: [
      'seni döverim',
      'seni öldürürüm',
      'sana bir şey yaparım',
      'pişman ederim',
      'peşini bırakmam',
      'ifşa ederim',
    ],
    response:
      'Bu çok ciddi. Lütfen mesajı hemen anne veya babana göster ve ekran görüntüsünü al. Güvende olmalısın ve bu senin suçun değil.',
  },
  {
    category: 'Şüpheli Fiziksel/Cinsel İstismar İpucu',
    severity: 'critical',
    keywords: [
      'dokundurdu',
      'vücuduma dokundu',
      'özel yerim',
      'yalnız kaldık',
      'sır olarak saklamamı',
    ],
    response:
      'Anlattığın şey seni rahatsız etmiş olabilir. Güvendiğin bir büyüğe (anne, baba, öğretmen) bunu anlatman çok önemli. "Kimseye söyleme" dense bile söyleyebilirsin. Sen hiçbir şekilde suçlu değilsin.',
  },
  {
    category: 'Kişisel Veri / Fotoğraf İsteği',
    severity: 'warning',
    keywords: ['fotoğraf at', 'foto at', 'video at', 'selfie', 'üstünü', 'fotoğrafını'],
    response:
      'Tanımadığın biriyle asla fotoğraf ya da özel görüntü paylaşma. Biri senden isterse mesajı kapat ve anne veya babana haber ver. Sen suçlu değilsin!',
  },
  {
    category: 'Şifre Güvenliği',
    severity: 'warning',
    keywords: ['şifre', 'parola', 'giriş bilgisi', 'şifremi'],
    response:
      'Şifren senin gizli anahtarındır. Sadece anne ve babanla paylaşabilirsin; internetteki hiç kimseye verme.',
  },
  {
    category: 'Kişisel Konum & Bilgi Gizliliği',
    severity: 'warning',
    keywords: [
      'adresim',
      'evim nerede',
      'telefon numaram',
      'hangi okul',
      'nerede oturuyorsun',
      'okulun adı',
    ],
    response:
      'Ev adresin, okulunun adı ve telefon numaran sana özel bilgilerdir. Tanımadığın kişilere asla söyleme.',
  },
  {
    category: 'Siber Zorbalık / Olumsuz Mesaj',
    severity: 'warning',
    keywords: [
      'kötü mesaj',
      'küfür etti',
      'tehdit etti',
      'korktum',
      'rahatsız',
      'hakaret etti',
      'zorba',
      'dalga geç',
    ],
    response:
      'Bazen insanlar internette kaba olabiliyor ama bu asla senin suçun değil. Cevap verme, ekranı kapat ve durumu anne veya babana anlat.',
  },
  {
    category: 'Şüpheli Bağlantı / Oltalama',
    severity: 'warning',
    keywords: ['bedava robux', 'bedava elmas', 'bedava skin', 'bedava vbucks', 'kazandın', 'hediye kazan'],
    response:
      '"Hediye kazandın" ya da "bedava Robux" gibi mesajlardaki bağlantılara tıklama; hesabını çalmaya çalışan tuzaklardır. Önce anne veya babana göster.',
  },
];

function normalize(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

export interface SafetyHit {
  category: string;
  severity: SafetyRule['severity'];
  response: string;
}

/** Mesajda tehlike/kişisel bilgi varsa ilk (en ciddi) eşleşmeyi döner. */
export function checkChildMessage(text: string): SafetyHit | null {
  const t = normalize(text);
  for (const rule of SAFETY_RULES) {
    if (rule.keywords.some((k) => t.includes(k))) {
      return { category: rule.category, severity: rule.severity, response: rule.response };
    }
  }
  return null;
}
