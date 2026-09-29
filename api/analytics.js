// LEVEL 4: Analytics API
// Admin endpoints for system statistics and monitoring

const { query } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action, period = 'week' } = req.body;

    // Verify admin
    const adminId = initData?.user?.id;
    if (!adminId) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const adminRes = await query(
      `SELECT "isModerator" FROM "User" WHERE "telegramId" = $1`,
      [adminId]
    );
    if (!adminRes.rows.length || !adminRes.rows[0].isModerator) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }

    // ==================== GET BASIC STATS ====================
    if (action === 'basic_stats') {
      const [users, active, banned, tasks, payments, messages] = await Promise.all([
        query(`SELECT COUNT(*) as count FROM "User"`),
        query(`SELECT COUNT(*) as count FROM "User" WHERE "lastSeen" >= NOW() - INTERVAL '7 days'`),
        query(`SELECT COUNT(*) as count FROM "User" WHERE "isBanned" = true`),
        query(`SELECT COUNT(*) as count FROM "Task"`),
        query(`SELECT SUM("amount") as total FROM "Payment" WHERE "status" = 'succeeded'`),
        query(`SELECT COUNT(*) as count FROM "Message"`),
      ]);

      return res.json({
        ok: true,
        stats: {
          totalUsers: users.rows[0]?.count || 0,
          activeUsers: active.rows[0]?.count || 0,
          bannedUsers: banned.rows[0]?.count || 0,
          totalTasks: tasks.rows[0]?.count || 0,
          totalRevenue: payments.rows[0]?.total || 0,
          messagesCount: messages.rows[0]?.count || 0,
        },
      });
    }

    // ==================== GET DAILY STATS ====================
    if (action === 'daily_stats') {
      const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
      const stats = await query(
        `SELECT * FROM "DailyStats" WHERE "date" >= CURRENT_DATE - INTERVAL '${days} days' ORDER BY "date" DESC`
      );

      return res.json({
        ok: true,
        stats: stats.rows,
        period,
        count: stats.rows.length,
      });
    }

    // ==================== GET TOP USERS ====================
    if (action === 'top_users') {
      const topUsers = await query(
        `SELECT "id", "name", "email", "reputation", "completedTasksCount", "balance" 
         FROM "User" WHERE "isBanned" = false ORDER BY "reputation" DESC LIMIT 20`
      );

      return res.json({
        ok: true,
        users: topUsers.rows,
      });
    }

    // ==================== GET RECENT PAYMENTS ====================
    if (action === 'recent_payments') {
      const payments = await query(
        `SELECT p.*, u."name" FROM "Payment" p 
         LEFT JOIN "User" u ON p."userId" = u."id" 
         ORDER BY p."createdAt" DESC LIMIT 30`
      );

      return res.json({
        ok: true,
        payments: payments.rows,
      });
    }

    // ==================== GET SYSTEM HEALTH ====================
    if (action === 'system_health') {
      const logs = await query(
        `SELECT "level", COUNT(*) as count FROM "SystemLog" 
         WHERE "createdAt" >= NOW() - INTERVAL '24 hours' 
         GROUP BY "level"`
      );

      const recentErrors = await query(
        `SELECT * FROM "SystemLog" WHERE "level" = 'error' ORDER BY "createdAt" DESC LIMIT 10`
      );

      return res.json({
        ok: true,
        logLevels: logs.rows.reduce((acc, row) => {
          acc[row.level] = row.count;
          return acc;
        }, {}),
        recentErrors: recentErrors.rows,
      });
    }

    // ==================== GET MODERATION STATS ====================
    if (action === 'moderation_stats') {
      const [bans, mutes, reports] = await Promise.all([
        query(`SELECT COUNT(*) as count FROM "AdminLog" WHERE "action" = 'ban_user' AND "createdAt" >= NOW() - INTERVAL '7 days'`),
        query(`SELECT COUNT(*) as count FROM "UserMute" WHERE "createdAt" >= NOW() - INTERVAL '7 days'`),
        query(`SELECT "status", COUNT(*) as count FROM "UserReport" GROUP BY "status"`),
      ]);

      return res.json({
        ok: true,
        bans: bans.rows[0]?.count || 0,
        mutes: mutes.rows[0]?.count || 0,
        reports: reports.rows.reduce((acc, row) => {
          acc[row.status] = row.count;
          return acc;
        }, {}),
      });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('Analytics API error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
