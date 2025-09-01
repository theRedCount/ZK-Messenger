// src/lib/server.js
export const InMemoryServer = {
  users: new Map(),    // email -> record
  messages: new Map(), // rcpt_id -> [ envelopes ]

  upsertUser(userRecord) {
    this.users.set(userRecord.email, userRecord);
  },
  getUser(email) {
    return this.users.get(email);
  },
  putMessage(rcpt_id, env) {
    if (!this.messages.has(rcpt_id)) this.messages.set(rcpt_id, []);
    this.messages.get(rcpt_id).push(env);
  },
  fetchMessages(rcpt_id) {
    const arr = this.messages.get(rcpt_id) || [];
    this.messages.set(rcpt_id, []); // clear after fetch
    return arr;
  }
};
