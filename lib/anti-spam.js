// LEVEL 4: Anti-Spam Protection
// Content filtering, rate limiting, and spam detection

const { query } = require('./db');

// Bad words/spam patterns
const BAD_WORDS = new Set([
  'spam', 'viagra', 'casino', 'crypto', 'xxx', 'porn', 'xxx18',
  'malware', 'hack', 'crack', 'phishing'
]);

// Rate limiting (in-memory)
const rateLimitMap = new Map(); // userId -> [timestamps]

/**
 * Check if message contains bad words
 */
const checkContent = (text) => {
  if (!text || typeof text !== 'string') return { clean: true };
  
  const lower = text.toLowerCase();
  for (const word of BAD_WORDS) {
    if (lower.includes(word)) {
      return { clean: false, word, severity: 'high' };
    }
  }
  return { clean: true };
};

/**
 * Check rate limit (max messages per time window)
 */
const checkRateLimit = (userId, maxMessages = 10, windowSeconds = 60) => {
  if (!userId) return { limited: false, count: 0 };
  
  const key = `user_${userId}`;
  const now = Date.now();
  const window = windowSeconds * 1000;

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, [now]);
    return { limited: false, count: 1 };
  }

  let timestamps = rateLimitMap.get(key) || [];
  // Remove old timestamps outside window
  timestamps = timestamps.filter(ts => now - ts < window);
  
  if (timestamps.length >= maxMessages) {
    return { limited: true, count: timestamps.length, window: windowSeconds };
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return { limited: false, count: timestamps.length };
};

/**
 * Log suspicious activity
 */
const logAbuse = async (userId, type, reason, details = {}) => {
  try {
    await query(
      `INSERT INTO "SystemLog" (level, message, context, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      ['warning', `${type}: ${reason}`, JSON.stringify({ userId, type, details })]
    );
    console.warn(`[ABUSE] ${type} - User #${userId}: ${reason}`);
  } catch (e) {
    console.error('Failed to log abuse:', e.message);
  }
};

/**
 * Get user's mute status
 */
const checkMuteStatus = async (userId) => {
  try {
    const res = await query(
      `SELECT "id", "muteUntil" FROM "UserMute" WHERE "userId" = $1 AND "muteUntil" > NOW()`,
      [userId]
    );
    if (res.rows.length > 0) {
      return { muted: true, until: res.rows[0].muteUntil };
    }
    return { muted: false };
  } catch (e) {
    return { muted: false, error: e.message };
  }
};

/**
 * Validate user behavior
 */
const validateUserBehavior = async (userId) => {
  try {
    // Check if muted
    const muteCheck = await checkMuteStatus(userId);
    if (muteCheck.muted) {
      return { ok: false, error: `User muted until ${muteCheck.until}` };
    }

    // Check if banned
    const userRes = await query(
      `SELECT "isBanned" FROM "User" WHERE id = $1`,
      [userId]
    );
    if (!userRes.rows.length) {
      return { ok: false, error: 'User not found' };
    }
    if (userRes.rows[0].isBanned) {
      return { ok: false, error: 'User is banned' };
    }

    return { ok: true };
  } catch (e) {
    console.error('validateUserBehavior error:', e);
    return { ok: false, error: e.message };
  }
};

module.exports = {
  checkContent,
  checkRateLimit,
  logAbuse,
  checkMuteStatus,
  validateUserBehavior,
};
