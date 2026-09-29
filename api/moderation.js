// LEVEL 4: Moderation API
// Admin endpoints for managing users and content

const { query } = require('../lib/db');
const { validateInitData } = require('../lib/telegram-init-data');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action, targetId, reason, duration } = req.body;

    // Verify admin
    const adminId = initData?.user?.id;
    if (!adminId) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const adminRes = await query(
      `SELECT "id", "isModerator", "name" FROM "User" WHERE "telegramId" = $1`,
      [adminId]
    );
    if (!adminRes.rows.length || !adminRes.rows[0].isModerator) {
      return res.status(403).json({ ok: false, error: 'Not a moderator' });
    }
    const admin = adminRes.rows[0];

    // ==================== BAN USER ====================
    if (action === 'ban_user') {
      if (!targetId) return res.status(400).json({ ok: false, error: 'Missing targetId' });

      // Ban user
      await query(`UPDATE "User" SET "isBanned" = true WHERE "id" = $1`, [targetId]);

      // Log action
      await query(
        `INSERT INTO "AdminLog" ("adminId", "action", "targetId", "targetType", "reason", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [admin.id, 'ban_user', targetId, 'user', reason || 'No reason provided']
      );

      return res.json({
        ok: true,
        message: `User #${targetId} banned by ${admin.name}`,
        action: 'ban_user',
        targetId,
      });
    }

    // ==================== MUTE USER ====================
    if (action === 'mute_user') {
      if (!targetId) return res.status(400).json({ ok: false, error: 'Missing targetId' });
      if (!duration) return res.status(400).json({ ok: false, error: 'Missing duration' });

      const muteUntil = new Date(Date.now() + duration * 1000);

      // Create mute record
      await query(
        `INSERT INTO "UserMute" ("userId", "reason", "muteUntil", "createdAt")
         VALUES ($1, $2, $3, NOW())`,
        [targetId, reason || 'No reason provided', muteUntil]
      );

      // Log action
      await query(
        `INSERT INTO "AdminLog" ("adminId", "action", "targetId", "targetType", "reason", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [admin.id, 'mute_user', targetId, 'user', `${duration}s - ${reason}`]
      );

      return res.json({
        ok: true,
        message: `User #${targetId} muted until ${muteUntil.toISOString()}`,
        action: 'mute_user',
        targetId,
        muteUntil,
      });
    }

    // ==================== UNMUTE USER ====================
    if (action === 'unmute_user') {
      if (!targetId) return res.status(400).json({ ok: false, error: 'Missing targetId' });

      await query(`DELETE FROM "UserMute" WHERE "userId" = $1`, [targetId]);

      // Log action
      await query(
        `INSERT INTO "AdminLog" ("adminId", "action", "targetId", "targetType", "reason", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [admin.id, 'unmute_user', targetId, 'user', reason || 'Manual unmute']
      );

      return res.json({
        ok: true,
        message: `User #${targetId} unmuted`,
        action: 'unmute_user',
        targetId,
      });
    }

    // ==================== GET MODERATION LOGS ====================
    if (action === 'get_logs') {
      const limit = 50;
      const logsRes = await query(
        `SELECT * FROM "AdminLog" ORDER BY "createdAt" DESC LIMIT $1`,
        [limit]
      );

      return res.json({
        ok: true,
        logs: logsRes.rows,
        count: logsRes.rows.length,
      });
    }

    // ==================== GET USER REPORTS ====================
    if (action === 'get_reports') {
      const reportsRes = await query(
        `SELECT * FROM "UserReport" WHERE "status" = 'open' ORDER BY "createdAt" DESC LIMIT 50`
      );

      return res.json({
        ok: true,
        reports: reportsRes.rows,
        count: reportsRes.rows.length,
      });
    }

    // ==================== RESOLVE REPORT ====================
    if (action === 'resolve_report') {
      if (!targetId) return res.status(400).json({ ok: false, error: 'Missing targetId' });

      const decision = req.body.decision || 'approved';
      await query(
        `UPDATE "UserReport" SET "status" = 'resolved', "decision" = $1, "resolvedAt" = NOW() WHERE "id" = $2`,
        [decision, targetId]
      );

      // Log action
      await query(
        `INSERT INTO "AdminLog" ("adminId", "action", "targetId", "targetType", "reason", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [admin.id, 'resolve_report', targetId, 'report', decision]
      );

      return res.json({
        ok: true,
        message: `Report #${targetId} resolved as ${decision}`,
        action: 'resolve_report',
      });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('Moderation API error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
