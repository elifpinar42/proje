import type { Db } from '../db';
import { decrypt } from '../security';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * AI çağrıları bu arayüzün arkasındadır. Şimdilik yalnızca ebeveynin kendi
 * anahtarını kullanan `UserKeyProvider` vardır; ileride ücretli sürümde
 * `ManagedProvider` (kullanım sayacı + abonelik) eklenebilir.
 */
export interface AiProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

export const CHILD_SYSTEM_PROMPT = `Sen "Rehber" adında, çocuklara yardım eden sıcak, sabırlı ve güvenli bir asistansın.
Kurallar:
- Türkçe, kısa, basit ve yaşa uygun cümlelerle konuş (en fazla 5-6 cümle).
- Şiddet, cinsellik, kumar, uyuşturucu, kişisel veri paylaşımı gibi konularda yardım etme; nazikçe reddet ve güvendiği bir yetişkine (anne/baba) anlatmasını öner.
- Çocuktan adres, okul, telefon, şifre ya da fotoğraf isteme; bunları paylaşmaması gerektiğini hatırlat.
- Çocuk üzgün, korkmuş ya da tehdit altında görünüyorsa sakinleştir ve bir yetişkine anlatmasını öner.
- Bilmediğin bir şeyi uydurma; "bilmiyorum" de.`;

export interface AiConfigRow {
  mode: string;
  enabled: number;
  base_url: string;
  model: string;
  api_key_enc: string | null;
}

export class UserKeyProvider implements AiProvider {
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string | null,
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 400,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI sağlayıcısı ${res.status} döndürdü: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('AI sağlayıcısı boş yanıt döndürdü');
    return content;
  }
}

export function getAiConfig(db: Db, parentId: string): AiConfigRow | undefined {
  return db.get<AiConfigRow>('SELECT * FROM ai_config WHERE parent_id = ?', parentId);
}

export function isAiEnabled(db: Db, parentId: string): boolean {
  const c = getAiConfig(db, parentId);
  return !!c && c.mode === 'own_key' && !!c.enabled && !!c.model && !!c.base_url;
}

export function providerFor(db: Db, parentId: string, key: Buffer): AiProvider | null {
  const c = getAiConfig(db, parentId);
  if (!c || !isAiEnabled(db, parentId)) return null;
  const apiKey = c.api_key_enc ? decrypt(c.api_key_enc, key) : null;
  return new UserKeyProvider(c.base_url, c.model, apiKey);
}
