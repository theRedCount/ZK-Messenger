// src/lib/server.js
export const InMemoryServer = {
  users: new Map(),          // email -> record
  messages: new Map(),       // rcpt_id -> [ envelopes ]
  conversations: new Map(),  // conv_token -> [ envelopes ]

  upsertUser(userRecord) {
    this.users.set(userRecord.email, userRecord);
  },
  getUser(email) {
    return this.users.get(email);
  },
  getUserByRcptId(rcpt_id) {
    for (const u of this.users.values()) if (u.rcpt_id === rcpt_id) return u;
    return null;
  },
  listUsers() {
    return Array.from(this.users.values()).map(u => ({
      email: u.email,
      rcpt_id: u.rcpt_id,
      enc_pub_rand_b64: u.enc_pub_rand_b64,
      sign_pub_det_b64: u.sign_pub_det_b64
    }));
  },
  putMessage(rcpt_id, envelope, conv_token) {
    if (!this.messages.has(rcpt_id)) this.messages.set(rcpt_id, []);
    this.messages.get(rcpt_id).push(envelope);

    if (!this.conversations.has(conv_token)) this.conversations.set(conv_token, []);
    this.conversations.get(conv_token).push(envelope);
  },
  fetchMessages(rcpt_id) {
    const arr = this.messages.get(rcpt_id) || [];
    this.messages.set(rcpt_id, []);
    return arr;
  },
  fetchConversation(conv_token) {
    // non distruttivo: la conversazione è “storica”
    return (this.conversations.get(conv_token) || []).slice();
  }
};
