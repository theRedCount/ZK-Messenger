# ZK Messenger — Flussi & Criptografia (versione2-dedk)

## Flussi principali

### 1. Registrazione

**Scopo:** generare e pubblicare le chiavi dell’utente.

* **Input:** email + password.

* **Passaggi:**

  1. Da `(email, password)` → Argon2id deterministico → `deterministic master`.
  2. HKDF → coppie chiavi deterministiche:

     * Ed25519 (firma)
     * X25519 (decifratura sealed)
  3. Generazione random Argon2id → `random master`.
  4. HKDF → coppie chiavi random (Ed25519, X25519).
  5. `random master` sigillato con la chiave deterministica X25519 → `c_master_b64`.
  6. Server memorizza: `email`, `sign_pub_det_b64`, `enc_pub_rand_b64`, `c_master_b64`.

* **Output:** account registrato sul server, pronto per login.

---

### 2. Login

**Scopo:** ricostruire runtime keys da password, senza salvare nulla localmente.

* **Input:** email + password.

* **Passaggi:**

  1. Ricalcolo deterministico da `(email, password)`.
  2. Recupero `c_master_b64` dal server.
  3. Decrypt con X25519 deterministico → `random master`.
  4. HKDF → runtime keys (Ed25519, X25519) usate per la sessione.

* **Output:** utente autenticato con runtime keys.

---

### 3. Inizializzazione Conversazione

**Scopo:** stabilire un root segreto condiviso (R).

* **Input:** le runtime chiavi X25519.

* **Passaggi:**

  1. Static-Static DH: `myXPriv ⨉ peerXPub` → shared.
  2. HKDF(shared, "conv-root\:v1") → R.
  3. HKDF(R, "conv-id\:v1") → conv\_token.

* **Output:** conv\_token (chiave lookup sul server) e root R.

---

### 4. Invio Messaggio (DEDK sealed sender)

**Scopo:** cifrare e firmare un messaggio che solo il destinatario può leggere.

* **Input:** testo, conv\_root R, conv\_token.

* **Passaggi:**

  1. Genero msg\_id random (16B).
  2. Derivo ephemeral deterministico: `a_sk, a_pk` = HKDF(R, msg\_id, senderPubX).
  3. Calcolo shared: `a_sk ⨉ peerXPub` → shared.
  4. HKDF(shared, `mk|msg_id`) → mk (chiave simmetrica per AEAD).
  5. Creo body JSON con: ts, msg\_id, sender\_email, sender\_pub\_ed, sender\_pub\_x, testo.
  6. Creo ctx: `ctx:v1|rcpt=peer_pub|eph=a_pk|msg_id=msg_id`.
  7. Firma Ed25519 (runtime.edPriv) su body+ctx.
  8. AEAD XSalsa20-Poly1305 su payload {body\_b64, sig\_b64, ctx\_b64} con mk.
  9. Creo envelope: {rcpt\_id, conv\_token, ts, msg\_id, eph\_pub, nonce, ct}.
  10. Server salva envelope sotto conv\_token.

* **Output:** envelope memorizzato dal server.

---

### 5. Ricezione/Fetched Conversation

**Scopo:** scaricare e decifrare messaggi.

* **Input:** conv\_token, runtime keys.

* **Passaggi per ogni envelope:**

  1. Tentativo INCOMING:

     * shared\_in = myXPriv ⨉ eph\_pub.
     * mk\_in = HKDF(shared\_in, msg\_id).
     * Decifra ct con mk\_in.
  2. Se fallisce, tentativo OUTGOING:

     * Rebuild ephemeral deterministico (R, myPubX, msg\_id).
     * shared\_out = eph\_sk ⨉ peer\_pub.
     * mk\_out = HKDF(shared\_out, msg\_id).
     * Decifra.
  3. Estraggo body, sig, ctx.
  4. Verifico firma con sender\_pub\_ed.
  5. Se ok → messaggio valido.

* **Output:** lista messaggi decifrati con direzione (in/out) e stato firma.

---

## Note di Sicurezza

* Nessun messaggio in chiaro sul server.
* Server vede solo: rcpt\_id, conv\_token, eph\_pub, ct.
* Mittente e destinatario possono ricostruire i propri messaggi grazie all’ephemeral deterministico (DEDK).
* Logout/browser close → basta email+password per ricalcolare tutto.
* Forward secrecy per-messaggio grazie all’uso di ephemeral unici.

---

## Riassunto in breve

1. **Register:** email+pwd → chiavi deterministiche + random sealed.
2. **Login:** ricostruisco deterministic, riapro random master sealed.
3. **Conv init:** DH static-static → root R, conv\_token.
4. **Send:** msg\_id → ephemeral deterministico → AEAD → envelope.
5. **Fetch:** ricostruisco ephemeral, decrypt, verify firma.

👉 ZK Messenger garantisce zero knowledge: il server non può mai leggere né inferire il contenuto dei messaggi.
