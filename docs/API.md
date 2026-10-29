# API

Taban yol: `/api`. Gövde ve yanıtlar JSON’dur. Hatalar `{ "error": "Türkçe mesaj" }` biçimindedir; geçersiz girdide `400` ve `issues` listesi döner.

**Kimlik doğrulama**

- *Ebeveyn:* `Authorization: Bearer <accessToken>` (JWT, 15 dk). Yenileme `dr_refresh` HttpOnly çerezi ile (7 gün, her kullanımda döner).
- *Cihaz (ajan):* `Authorization: Bearer drd_…` cihaz jetonu.
- Başka ebeveyne ait kayıtlar her zaman `404` döner.

## Genel

| Yöntem | Yol | Yetki | Açıklama |
|---|---|---|---|
| GET | `/health` | yok | `{status:"ok", version, time}` |

## Kimlik — `/auth`

| Yöntem | Yol | Yetki | Açıklama |
|---|---|---|---|
| POST | `/auth/register` | yok (hız sınırlı) | `{username, password}` → `201 {accessToken, expiresIn, user, recoveryCodes[8]}` |
| POST | `/auth/login` | yok (hız sınırlı) | `{username, password, totp?}` → `{accessToken, user}`; 2FA açıksa ve kod yoksa `401 {totpRequired:true}` |
| POST | `/auth/refresh` | çerez | Yeni erişim jetonu; kullanılmış jeton tekrar gelirse tüm oturumlar kapatılır |
| POST | `/auth/logout` | ebeveyn | Oturumu sonlandırır |
| GET | `/auth/me` | ebeveyn | `{user, recoveryCodesLeft}` |
| GET | `/auth/sessions` | ebeveyn | Açık oturumlar |
| DELETE | `/auth/sessions/:id` | ebeveyn | Bir oturumu sonlandır |
| DELETE | `/auth/sessions` | ebeveyn | Diğer tüm oturumları sonlandır |
| POST | `/auth/recover` | yok (hız sınırlı) | `{username, recoveryCode, newPassword}`; kod tek kullanımlıktır, 2FA kapatılır, oturumlar sonlanır |
| POST | `/auth/recovery-codes` | ebeveyn | `{password}` → yeni 8 kurtarma kodu (eskiler geçersiz) |
| POST | `/auth/2fa/setup` | ebeveyn | `{secret, otpauthUrl, qrCode}` |
| POST | `/auth/2fa/enable` | ebeveyn | `{token}` |
| POST | `/auth/2fa/disable` | ebeveyn | `{password, token}` |

Şifre kuralı: en az 8 karakter, en az bir harf ve bir rakam.

## Çocuklar ve cihazlar (ebeveyn)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/children` | `{items:[{id,name,createdAt,deviceCount}]}` |
| POST | `/children` | `{name}` → `201 {id,name}` (varsayılan ayarlar oluşturulur) |
| DELETE | `/children/:id` | Profili ve tüm verilerini siler |
| DELETE | `/children/:id/data` | Olay, nabız ve sohbet kayıtlarını siler |
| POST | `/children/:id/pairing-code` | `201 {code, expiresAt}` (10 dk, tek kullanımlık) |
| GET | `/children/:id/devices` | Eşleşmiş cihazlar |
| DELETE | `/devices/:id` | Cihazı kaldırır (jetonu geçersiz olur) |
| GET / PUT | `/children/:id/settings` | `{sensitivity, screenEnabled, keyboardEnabled, cameraEnabled, micEnabled, notifyParentOnRisk, retentionDays}` |

## İzleme verisi (ebeveyn)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/children/:id/status` | Son nabızdan canlı durum: `{online, lastSeen, riskScore, emotion, windowTitle, audioLevel, keyboardRisk, deviceCount}` (30 sn içinde nabız varsa `online`) |
| GET | `/children/:id/events` | Sorgu: `from, to, minScore, source(risk\|chat), limit(≤200), offset` → `{total, items[]}` |
| GET | `/children/:id/summary` | Sorgu: `days(1–90), tz` (dk, `Date.getTimezoneOffset()`) → `{screenSeconds, eventCount, avgRisk, maxRisk, emotionCounts, daily[]}` — yalnızca gerçek nabız/olay verisinden |
| GET | `/stream` | **SSE.** `event: heartbeat` ve `event: event` mesajları; istemci `fetch` + `Authorization` ile bağlanır |
| POST | `/reports/pdf?tz=` | `{childId, days}` → `application/pdf` |

## AI ayarları (ebeveyn)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/ai/config` | `{mode:"own_key", enabled, baseUrl, model, hasKey}` — **anahtar hiçbir yanıtta dönmez** |
| PUT | `/ai/config` | `{enabled, baseUrl, model, apiKey?}`; `apiKey` boşsa mevcut anahtar korunur |
| DELETE | `/ai/config/key` | Anahtarı siler, AI’ı kapatır |
| POST | `/ai/test` | `{ok, sample?, error?}` — sağlayıcıya deneme isteği |

## Güvenlik günlüğü



## Ajan — `/agent` (cihaz jetonu)

| Yöntem | Yol | Yetki | Açıklama |
|---|---|---|---|
| POST | `/agent/pair` | yok (10/15 dk) | `{code, deviceName?}` → `201 {deviceToken, deviceId, childId, childName, settings}` |
| GET | `/agent/settings` | cihaz | `{childName, settings, aiEnabled, serverTime}` |
| POST | `/agent/heartbeat` | cihaz | `{riskScore, emotion, windowTitle?, audioLevel?, keyboardRisk?, expressions?, activeSeconds?}` → `{ok, settings}` |
| POST | `/agent/events` | cihaz | `{title, details, score, category, windowTitle?, emotion?, occurredAt?, source?}` |
| POST | `/agent/chat` | cihaz | `{message, history?}` → `{reply, flagged}`; AI kapalıysa `503 {assistantDisabled:true}` |

### Örnek

```bash
# kayıt
curl -X POST http://localhost:3000/api/auth/register -H 'content-type: application/json' \
  -d '{"username":"ayse","password":"Parola123"}'

# çocuk ekle ve eşleştirme kodu al
curl -X POST http://localhost:3000/api/children -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Elif"}'
curl -X POST http://localhost:3000/api/children/$CHILD/pairing-code -H "authorization: Bearer $TOKEN"
# → {"code":"523665","expiresAt":1793000000000}
```
