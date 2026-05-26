# Ata Samancılık — Facebook Yorum Otomasyon Sistemi

Facebook public comment reply otomasyonu.  
**MVP kapsamı:** Yalnızca Facebook sayfa yorumları. DM / Messenger / Instagram / WhatsApp kapsam dışı.

---

## İçindekiler

- [Mimari](#mimari)
- [Kurulum](#kurulum)
- [Ortam Değişkenleri](#ortam-değişkenleri)
- [Veritabanı](#veritabanı)
- [Çalıştırma](#çalıştırma)
- [Otomasyon Modları](#otomasyon-modları)
- [Meta App Kurulumu](#meta-app-kurulumu)
- [Webhook Testi](#webhook-testi)
- [Admin API](#admin-api)
- [Testler](#testler)
- [KVKK ve Gizlilik](#kvkk-ve-gizlilik)
- [Sorun Giderme](#sorun-giderme)

---

## Mimari

```
Meta Webhook POST
      │
      ▼
Signature Verify (HMAC-SHA256)
      │
      ▼
Idempotency Check (platform + comment_id)
      │
      ▼
BullMQ Comment Queue
      │
      ▼
Comment Worker
  ├─ Graph API → yorum detayı (text, authorId)
  ├─ author_id → HMAC hash (KVKK)
  └─ Pipeline:
        ├─ Rule Engine (deterministic, saf TS)
        │     ├─ Normalizer (Türkçe karakter, alias)
        │     ├─ City Detector (81 il + alias)
        │     ├─ Intent Classifier (14 intent)
        │     └─ Reply Builder (template)
        ├─ LLM Fallback (sadece UNKNOWN intent'te)
        ├─ Safety Gate (uzunluk, placeholder, PII)
        └─ Action Resolver (automation mode'a göre)
              ├─ send_now → Reply Queue → Meta Graph API
              ├─ queue_for_send → Reply Queue
              ├─ preview → Admin paneli (otomatik gönderim yok)
              └─ human_review → HumanReviewQueue
```

### Temel Tasarım Kararları

| Karar | Gerekçe |
|---|---|
| LLM yalnızca intent classification için | Fiyat/ürün halüsinasyonu riski → sıfır |
| Deterministic kural motoru önce çalışır | Güvenilir, izlenebilir, ucuz |
| Webhook handler asenkron (hızlı 200 OK) | Meta tekrar deneme mekanizmasını tetiklememek |
| Ham author ID saklanmaz, HMAC hash | KVKK pseudonymization |
| Default mod: `preview_only` | Yanlış gönderim sıfır (üretimde kademeli arttır) |

---

## Kurulum

### Gereksinimler

- Node.js ≥ 20
- Docker & Docker Compose (PostgreSQL + Redis)

```bash
git clone <repo>
cd ata-samancilik-comment-manager

# Bağımlılıkları yükle
npm install

# Ortam dosyasını oluştur
cp .env.example .env
# .env dosyasını düzenle (aşağıdaki tabloya bak)
```

---

## Ortam Değişkenleri

`.env.example` dosyasını kopyalayıp doldurun.

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/db` |
| `REDIS_HOST` | ✅ | Redis host (docker: `localhost`) |
| `META_WEBHOOK_VERIFY_TOKEN` | ✅ | Meta panelinde girilen verify token |
| `ADMIN_API_KEY` | ✅ | Admin API koruması için rastgele string |
| `META_APP_SECRET` | Üretimde ✅ | Webhook signature doğrulaması için |
| `META_PAGE_ACCESS_TOKEN` | Üretimde ✅ | Sayfa erişim token'ı |
| `META_PAGE_ID` | Opsiyonel | Sayfa ID |
| `LLM_PROVIDER` | — | `none` / `mock` (default: `mock`) |
| `AUTOMATION_MODE` | — | `preview_only` / `semi_auto` / `full_auto` (default: `preview_only`) |

---

## Veritabanı

```bash
# PostgreSQL + Redis başlat
docker-compose up -d

# Prisma migration çalıştır
npm run db:migrate

# 81 il fiyatı + ürün verisi seed'le
npm run db:seed
```

### Fiyat Güncelleme

Admin API ile runtime'da güncellenebilir:

```bash
# Tüm fiyatları listele
curl -H "x-admin-key: <ADMIN_API_KEY>" http://localhost:3000/admin/prices

# Tek fiyatı güncelle
curl -X PUT -H "x-admin-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"priceTryPerTon": 8000}' \
  http://localhost:3000/admin/prices/<id>
```

---

## Çalıştırma

### Geliştirme (server + worker birlikte)

```bash
npm run dev
```

### Üretim

```bash
npm run build

# Server + worker birlikte (küçük deployment)
node dist/index.js

# Ayrı process (ölçekleme için)
node dist/index.js --server   # HTTP server
node dist/index.js --worker   # Worker(lar)
```

### Sağlık Kontrolü

```bash
curl http://localhost:3000/health
# {"status":"ok","checks":{"database":{"ok":true},"redis":{"ok":true}},...}
```

---

## Otomasyon Modları

Sistem üç modda çalışır. **Üretime çıkarken `preview_only` ile başlayın.**

| Mod | Davranış |
|---|---|
| `preview_only` | Cevap üretir, **otomatik göndermez**. Admin panelinde gösterir. |
| `semi_auto` | Güvenli ve basit intent'leri (telefon sorusu, tonnage, genel fiyat) otomatik gönderir. Şehir+fiyat gibi riskli olanları kuyruğa alır. |
| `full_auto` | Kural motoru kesin karar verdiğinde (confidence=1.0) otomatik gönderir. |

**Mod değiştirme (runtime, DB'ye kaydedilir):**

```bash
curl -X PUT -H "x-admin-key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"semi_auto"}' \
  http://localhost:3000/admin/settings/automation-mode
```

---

## Meta App Kurulumu

### 1. Meta Developer App Oluştur

1. [developers.facebook.com](https://developers.facebook.com) → **Create App** → **Business**
2. App'e **Webhooks** ürününü ekle
3. App'e **Pages** ürününü ekle

### 2. Gerekli İzinler

App Review için şu izinlerin onaylanması gerekir:

| İzin | Kullanım |
|---|---|
| `pages_manage_engagement` | Yorum oluştur/yanıtla |
| `pages_read_user_content` | Yorum oku |
| `pages_read_engagement` | Sayfa istatistikleri |
| `pages_manage_metadata` | Webhook subscription |
| `pages_show_list` | Sayfa listesi |

### 3. Webhook Subscription

Webhook endpoint URL'niz: `https://<domain>/webhooks/meta`

```
Callback URL: https://your-domain.com/webhooks/meta
Verify Token: (META_WEBHOOK_VERIFY_TOKEN değeriniz)
Subscription Fields: ✅ feed
```

### 4. Page Access Token

```bash
# Graph API Explorer'dan uzun ömürlü token al:
# 1. developers.facebook.com/tools/explorer
# 2. İzinleri seç, token oluştur
# 3. Token'ı uzun ömürlü yap:
curl "https://graph.facebook.com/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id=<APP_ID>&
  client_secret=<APP_SECRET>&
  fb_exchange_token=<SHORT_TOKEN>"
```

Token'ı `.env` dosyasına `META_PAGE_ACCESS_TOKEN` olarak girin.

### 5. Token Sağlığını Kontrol Et

```bash
curl -X POST -H "x-admin-key: <key>" \
  http://localhost:3000/admin/meta/token-health
```

---

## Webhook Testi

### Lokal Ngrok ile Test

```bash
# 1. Ngrok kur ve başlat
ngrok http 3000

# 2. Meta Developer Console'da webhook URL'yi güncelle
# https://<ngrok_id>.ngrok.io/webhooks/meta

# 3. Meta'nın challenge'ını test et
curl "http://localhost:3000/webhooks/meta?\
hub.mode=subscribe&\
hub.verify_token=<META_WEBHOOK_VERIFY_TOKEN>&\
hub.challenge=test123"
# Yanıt: test123

# 4. Simüle webhook event gönder
APP_SECRET="your-secret"
BODY='{"object":"page","entry":[{"id":"123","time":1234567890,"changes":[{"field":"feed","value":{"item":"comment","verb":"add","comment_id":"987654321","message":"ankara fiyat nedir","from":{"id":"user123","name":"Test User"}}}]}]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $2}')"

curl -X POST http://localhost:3000/webhooks/meta \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: $SIG" \
  -d "$BODY"
```

---

## Admin API

Tüm endpoint'ler `x-admin-key: <ADMIN_API_KEY>` header'ı gerektirir.

### Yorumlar

```bash
# Liste (pagination)
GET /admin/comments?page=1&limit=20

# Tek yorum detayı
GET /admin/comments/:id

# Cevap önizleme (DB'ye yazmaz)
POST /admin/comments/:id/generate

# Cevabı onayla ve gönder
POST /admin/comments/:id/approve
Body: { "replyText": "isteğe bağlı düzenleme" }

# Human review'a aktar
POST /admin/comments/:id/human-review
Body: { "reason": "manual_transfer" }
```

### Human Review

```bash
# Bekleyen kuyruk
GET /admin/human-review?page=1&limit=20

# Çöz (onayla / reddet / düzenleyip gönder)
POST /admin/human-review/:id/resolve
Body: {
  "action": "approve" | "reject" | "edit_and_send",
  "editedReply": "düzenlenmiş metin (edit_and_send için)",
  "resolvedBy": "admin"
}
```

### Fiyatlar

```bash
GET /admin/prices
PUT /admin/prices/:id
Body: { "priceTryPerTon": 8000, "isActive": true }
```

### Ayarlar

```bash
GET  /admin/settings
PUT  /admin/settings/automation-mode
Body: { "mode": "preview_only" | "semi_auto" | "full_auto" }

POST /admin/meta/token-health
```

---

## Testler

```bash
# Tüm testler
npm test

# Watch modu
npm run test:watch

# Coverage raporu
npm run test:coverage
```

### Test Kapsamı

| Dosya | Konu |
|---|---|
| `normalizer.test.ts` | Türkçe karakter, city alias, garbage detection |
| `rule-engine.test.ts` | Brif senaryoları (bütün 11 senaryo) |
| `reply-builder.test.ts` | Tüm intent'ler için template doğruluğu |
| `safety-gate.test.ts` | Uzunluk, PII, placeholder, brand voice |
| `signature.test.ts` | HMAC-SHA256 verify, challenge |
| `pipeline.test.ts` | Automation mode, LLM fallback, context save |

---

## KVKK ve Gizlilik

| Konu | Uygulama |
|---|---|
| Kullanıcı platform ID | Ham değer **saklanmaz**. HMAC-SHA256 (META_APP_SECRET salt) ile hash'lenir. |
| Yorum metni | DB'de saklanır. Retention policy: 90 gün (henüz otomatik değil; FAZ 2). |
| Raw webhook payload | Opsiyonel. `rawPayloadJsonOptional` alanı; audit sonrası silinebilir. |
| Log redaction | Pino ile `authorization`, `access_token`, `secret`, `author_platform_id` otomatik `[REDACTED]`. |
| LLM'e gönderim | Sadece yorum metni. User ID, profil adı, sayfa ID gönderilmez. |

---

## Sorun Giderme

### Webhook challenge 403 dönüyor

`.env`'deki `META_WEBHOOK_VERIFY_TOKEN` ile Meta panelindeki değerin aynı olduğunu kontrol edin.

### Webhook 401 (invalid_signature)

- `META_APP_SECRET` tanımlı mı?
- Fastify'ın ham body'yi okuduğundan emin olun. `Content-Type: application/json` olan webhook POST'unu başka bir middleware'in yakalamadığını doğrulayın.

### Token expired (kod 190)

Reply worker durur, dead-letter queue'ya atar. Token'ı yenileyin:
1. `META_PAGE_ACCESS_TOKEN`'ı `.env`'de güncelleyin
2. Worker'ı yeniden başlatın

### Rate limit (kod 4/17/32/613)

Worker otomatik exponential backoff ile yeniden dener. `MAX_REPLIES_PER_MINUTE` değerini düşürmeyi düşünün.

### Şehir tanınmıyor

`src/application/normalizer/city-aliases.ts` dosyasına alias ekleyin. Örnek:

```ts
{ canonical: 'Şırnak', aliases: ['sirnak', 'şırnak'] },
```

Seed'de fiyat yoksa yorum otomatik `human_review`'a düşer.

### "unknown_product" human review doluyor

Katalog dışı ürün soruları (`yonca`, `arpa`, `saman` gibi) beklenen davranış: human review. Admin panelinden manuel cevap verin.

### DB migration başarısız

```bash
# Sıfırdan başlamak için (geliştirme)
npm run db:reset

# Üretimde sadece
npm run db:migrate:deploy
```
