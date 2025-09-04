# Flussi completi Client ↔ Backend (tecnico + motivazioni progettuali)

> **Scopo**: descrivere in profondità come funzionano i flussi di **registrazione**, **login**, **firma delle richieste** e **invio/ricezione dei messaggi**, spiegando **perché** sono state fatte queste scelte architetturali.

---

## 1) Registrazione

### Sequenza tecnica (client → backend)

1. **Input**: l’utente inserisce `email` e `password`.
2. **Derivazione chiavi deterministiche** (solo client):

   * `master_det` ← Argon2id(email+password) (param. «t=3, m=64MiB, p=hw»)
   * `edPriv_det, edPub_det` ← HKDF(master\_det, "ed25519-seed\:v1")
   * `xPriv_det, xPub_det` ← HKDF(master\_det, "x25519-seed\:v1")
3. **Derivazione chiavi runtime casuali** (solo client, per messaggistica):

   * Genera `ikm` + `salt` random → Argon2id → `master_random`
   * `edPriv_run, edPub_run` ← HKDF(master\_random, "ed25519-seed\:rand\:v1")
   * `xPriv_run, xPub_run` ← HKDF(master\_random, "x25519-seed\:rand\:v1")
4. **Sealing del master\_random**: `c_master` ← `crypto_box_seal(master_random, xPub_det)` (X25519/XSalsa20-Poly1305). Solo chi possiede **xPriv\_det** potrà aprirlo.
5. **POST /register** (pubblica):

   * Body: `{ email, sign_pub_det_b64=edPub_det, enc_pub_rand_b64=xPub_run, c_master_b64 }`
   * Il server crea `rcpt_id` (UUID v4), persiste il record e risponde con `{ email, rcpt_id, enc_pub_rand_b64, sign_pub_det_b64 }`.

### Motivazioni progettuali (discorsivo)

* **Zero-knowledge**: la password non lascia mai il device; il server non vede segreti utili per decifrare i messaggi.
* **Separazione dei ruoli**: chiavi **deterministiche** per autenticazione/firma JWS (identità), chiavi **runtime** per messaggistica (cifra/scambio). Così possiamo ruotare una senza toccare l’altra.
* **Sealed master**: consente di ricostruire le chiavi runtime *solo* conoscendo email+password; il server non può aprirlo.
* **`rcpt_id` come UUID**: evita di esporre direttamente le chiavi pubbliche come identificatori (minore correlabilità, più flessibilità lato server e logging).
* **Argon2id + HKDF**: resistenza al bruteforce offline e derivazioni indipendenti, riproducibili.

---

## 2) Login

### Sequenza tecnica

1. **Input**: `email`, `password`.
2. **Riderivazione chiavi deterministiche**: come in registrazione.
3. **POST /login** (protetta):

   * Header: `Authorization: Bearer <JWS(EdDSA)>`, `X-User-Email: <email>`
   * Il JWS è firmato con `edPriv_det`; payload include `act: "login"`, `iat/exp`, `jti`.
   * Il server verifica *solo* la firma (non usa la password) e ritorna il **record utente** (contenente `c_master_b64`).
4. **Apertura `c_master`** (solo client): `master_random` ← `crypto_box_seal_open(c_master, xPub_det, xPriv_det)`.
5. **Derivazione runtime**: da `master_random` rigeneriamo `edPriv_run/xPriv_run` (ed equivalenti pubbliche) per cifrare/decrifrare i messaggi.
6. **WebSocket**: il client apre `WS /ws/inbox?token=<JWS>&email=<email>` con `act:"ws.open"` e `rcpt_id` nel payload.

### Motivazioni progettuali

* **Stateless server**: il server non mantiene sessioni né segreti del client; valida ogni richiesta con JWS e la chiave pubblica dell’utente.
* **Niente password lato server**: riduce la superficie di attacco e responsabilità (nessun hash password da proteggere).
* **Anti-replay**: `jti` cache + `iat/exp` con leeway; difende da riuso di token.
* **WS con token in query**: il browser non consente `Authorization` custom sui WS; il token in query è una prassi compatibile.

---

## 3) Firma e verifica di **ogni** richiesta protetta

### Sequenza tecnica (request)

1. **Client** costruisce JWS compatto con:

   * Header: `{ alg:"EdDSA", kid: email, typ:"JWT" }`
   * Payload: `{ sub: email, act: <azione>, iat, exp, jti, ...extra }`
   * Firma: `Ed25519(signing_input, edPriv_det)` → base64url.
2. **HTTP**:

   * Header: `Authorization: Bearer <JWS>`, `X-User-Email: <email>`.

### Verifica (server)

1. Estrae email da header e JWS (`kid/sub`) e le confronta.
2. Carica `sign_pub_det_b64` dell’utente registrato.
3. Verifica **firma Ed25519**, **tempi** (`iat/exp`), **anti-replay** (`jti`).
4. Verifica semantica `act` (es. `login`, `users.list`, `send`, `fetch`, `ws.open`).

### Motivazioni progettuali

* **Ed25519**: firme veloci, chiavi piccole, ottimo supporto in librerie; nessun segreto condiviso (no HMAC/HS256).
* **Stateless auth**: scala bene (bilanciatori, più istanze server), nessun session storage.
* **Email negli header**: debugging semplice e matching esplicito con JWS; evita ambiguità.

---

## 4) Invio e ricezione messaggi (Sealed Sender)

### Invio (client)

1. **Ephemeral**: genera coppia X25519 effimera per *quel* messaggio.
2. **ECDH**: calcola `shared` = ECDH(eph\_priv, xPub\_run\_destinatario).
3. **Body in chiaro**: `{ v, ts_client, msg_id, sender_email, sender_pub_ed_b64, sender_pub_x_b64, message }`.
4. **Binding + firma**: concatena `body` con contesto `ctx = "ctx:v1|rcpt=<dest_pub_x_b64>|eph=<eph_pub_b64>"`; firma Ed25519 con `edPriv_run`.
5. **AEAD**: cifra `payload = { body_b64, sig_b64 }` con `XSalsa20-Poly1305` usando `shared` (via `crypto_box_easy_afternm`).
6. **Envelope**: `{ v, rcpt_id, ts_client, eph_pub_b64, nonce_b64, ct_b64 }`.
7. **POST /messages** (protetta da JWS con `act:"send"`).

### Server

* Valida JWS e destinatario, persiste l’envelope, notifica i client WS di `rcpt_id`.

### Ricezione (client destinatario)

1. **WS** riceve `envelope` in tempo reale (o tramite `GET /inbox`).
2. Calcola `shared` = ECDH(eph\_pub, `xPriv_run_dest`), decifra, ottiene `{ body, sig }`.
3. Ricostruisce `ctx` con la **propria** `xPub_run` e `eph_pub`.
4. Verifica la firma con `sender_pub_ed_b64` presente nel body.
5. Mostra il messaggio se `ok=true`.

### Motivazioni progettuali

* **Sealed sender**: il server non conosce il mittente (nel trasporto c’è solo `rcpt_id`), conosce solo metadati minimi per il routing.
* **Ephemeral per messaggio**: forward secrecy sul canale; anche se una chiave di lungo termine perde sicurezza, le sessioni passate sono più protette.
* **Binding del contesto**: impedisce replay/redirect dell’envelope verso altri destinatari o con altre ephemeral key.
* **XSalsa20-Poly1305** (via libsodium): cifratura autentica ad alte prestazioni, nonce ampio, API collaudate.

---

## 5) Considerazioni di sicurezza & trade-off

* **Il server non può decifrare**: possiede solo chiavi pubbliche e `c_master` cifrato.
* **Nessun salvataggio locale**: all’avvio il client deve fare login per rigenerare runtime (coerente con il requisito privacy, ma richiede password).
* **Recovery**: se l’utente dimentica la password, il server non può aiutare a recuperare messaggi (coerente con “Uncontrollable”). Possibili estensioni future: *social recovery* o *key escrow lato utente*, **mai** lato server.
* **Clock skew**: `leeway` nell’interpretazione di `iat/exp` per evitare falsi negativi.
* **Anti-replay**: cache `jti` in RAM (TTL) → per scalare, si può migrare a store condiviso (Redis) senza cambiare protocollo.
* **WS auth**: token nel query string perché i browser non consentono `Authorization` per WS; alternativa: subprotocol con token.
* **rcpt\_id** UUID\*\*:\*\* riduce correlazione, facilita migrazioni/rotazioni chiave publish lato server.

---

## 6) Campi principali (per riferimento rapido)

**JWS (Authorization)**

* Header: `alg=EdDSA`, `kid=email`, `typ=JWT`
* Payload: `sub=email`, `act`, `iat`, `exp`, `jti`, `...extra`

**Envelope**

```json
{
  "v": 1,
  "rcpt_id": "<uuid>",
  "ts_client": "<ISO8601>",
  "eph_pub_b64": "...",
  "nonce_b64": "...",
  "ct_b64": "..."
}
```

**Payload cifrato (dentro ct)**

```json
{
  "body_b64": "...",    // JSON body in base64
  "sig_b64": "..."      // firma Ed25519 del (body||ctx)
}
```

**Body**

```json
{
  "v": 1,
  "ts_client": "<ISO8601>",
  "msg_id": "<hex>",
  "sender_email": "alice@example.com",
  "sender_pub_ed_b64": "...",
  "sender_pub_x_b64": "...",
  "message": "..."
}
```

**Context (non trasmesso, ricostruito ai lati)**

```
ctx = "ctx:v1|rcpt=<dest_enc_pub_rand_b64>|eph=<eph_pub_b64>"
```

---

## 7) Perché questa architettura è “Uncontrollable”

* **Il server non detiene mai chiavi private**: non può leggere contenuti né rigenerare chiavi runtime.
* **Autenticazione forte**: ogni richiesta è firmata; niente sessioni rubabili lato server.
* **Cifratura end-to-end**: il server inoltra solo envelope opachi; i client fanno tutto.
* **Minimizzazione metadati**: il routing usa solo `rcpt_id`; l’identità del mittente resta nel payload cifrato.

---

## 8) Estensioni future (compatibili)

* **Ricevute di consegna/lettura** via WS (ACK firmati) → UI “double tick”.
* **Rotazione chiavi runtime**: rigenera da nuovo `master_random`, cifra e aggiorna `c_master` (backwards compatibile).
* **Store anti-replay distribuito** (es. Redis) per scale-out.
* **Multi-device**: stesso email+password → stessa identità; `rcpt_id` per device o identity-level con mapping.
