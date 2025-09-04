# Tesi di Laurea – Architettura “Uncontrollable”

---

## Indice

1. **Introduzione generale**

   * Contesto: privacy e messaggistica end-to-end
   * Motivazioni del progetto “Uncontrollable”
   * Obiettivi di ricerca e implementativi

2. **Analisi dei requisiti**

   * Requisiti funzionali (registrazione, login, chat)
   * Requisiti non funzionali (zero-knowledge, stateless server, anti-replay)

3. **Architettura complessiva**

   * Panoramica Client ↔ Backend
   * Ruolo delle chiavi deterministiche e runtime
   * Scelte tecnologiche (React, Redux, FastAPI, Sodium, Ed25519)

4. **Flusso di registrazione**

   * Sequenza tecnica
   * Motivazioni progettuali

5. **Flusso di login**

   * Sequenza tecnica
   * Motivazioni progettuali

6. **Firma e verifica delle richieste protette**

   * Standard JWS con Ed25519
   * Meccanismo di verifica lato server

7. **Invio e ricezione dei messaggi**

   * Sealed sender, cifratura AEAD, ephemeral keys
   * Flusso lato client e lato server

8. **Gestione WebSocket per messaggi in tempo reale**

   * Apertura, autenticazione, distribuzione
   * Motivazioni tecniche e limiti

9. **Considerazioni di sicurezza**

   * Minaccia e difesa (replay, MITM, brute-force)
   * Trade-off privacy vs. usabilità

10. **Estensioni future**

    * Multi-device
    * Key rotation
    * Delivery receipts

11. **Conclusioni**

    * Riflessioni finali
    * Contributo scientifico e pratico

---

## Introduzione

Negli ultimi anni, la crescente attenzione verso la **privacy digitale** ha reso evidente la necessità di sistemi di comunicazione che riducano al minimo la possibilità di sorveglianza e intercettazione. Le soluzioni esistenti, pur offrendo cifratura end-to-end (E2EE), spesso mantengono un certo grado di controllo lato server: archiviazione di metadati, gestione di chiavi, tracciamento delle identità. Questo apre a rischi legali e tecnici, dove le autorità o attaccanti potrebbero obbligare il gestore del servizio a fornire accesso a dati sensibili.

Il progetto **“Uncontrollable”** nasce con un obiettivo chiaro: realizzare un sistema di messaggistica in cui il server sia **deliberatamente incapace** di accedere alle conversazioni o ricostruire le chiavi private degli utenti. Tale design risponde al principio che, se i dati non sono tecnicamente accessibili, non possono essere consegnati a terzi, indipendentemente da pressioni o richieste legali.

La scelta architetturale è radicale: ogni operazione crittografica avviene **esclusivamente lato client**, mentre il server funge da mero trasporto e coordinatore, privo di conoscenze utili per decifrare. In questo contesto, diventa fondamentale definire un flusso di **registrazione** e **login** che non comprometta la segretezza, e al tempo stesso permetta al server di autenticare in maniera forte le richieste successive.

Le motivazioni progettuali si basano su tre assi principali:

* **Zero-knowledge**: il server non deve mai conoscere password, chiavi private o master secrets.
* **Statelessness**: l’autenticazione non si affida a sessioni salvate lato server ma a token firmati (JWS) verificabili in ogni singola richiesta.
* **Sealed sender**: il mittente non è rivelato al server; solo il destinatario può decifrare e verificare l’origine del messaggio.

Queste scelte derivano non solo da esigenze tecniche, ma da una precisa posizione etico-filosofica: creare un sistema che, per design, rende impossibile la cessione di dati sensibili. Nel seguito analizzeremo nel dettaglio i flussi implementativi e le ragioni che rendono questa architettura una risposta coerente alle sfide moderne della sicurezza delle comunicazioni.
