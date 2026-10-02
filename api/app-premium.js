import { verifyTelegramWebApp } from '../lib/telegram-verify.js';
import {
  PREMIUM_PLANS,
  getUserPremiumStatus,
  activatePremium,
  cancelPremium,
  getTasksCreatedToday,
  checkTasksPerDayLimit,
  getPremiumStats,
} from '../lib/premium.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData, action } = req.body;

    if (!initData) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user
    let userData;
    try {
      userData = verifyTelegramWebApp(initData);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid authorization' });
    }

    const userId = userData.user.id;

    // в•ђв•ђв•ђ GET STATUS в•ђв•ђв•ђ
    if (action === 'status') {
      const status = await getUserPremiumStatus(userId);
      const tasksToday = await getTasksCreatedToday(userId);
      const planInfo = PREMIUM_PLANS[status.currentPlan];
      const limit = planInfo.tasksPerDay;
      return res.status(200).json({
        ok: true,
        status,
        plans: PREMIUM_PLANS,
        tasksCreatedToday: tasksToday,
        tasksLimit: limit,
      });
    }

    // в•ђв•ђв•ђ GET PLANS в•ђв•ђв•ђ
    if (action === 'plans') {
      return res.status(200).json({
        ok: true,
        plans: PREMIUM_PLANS,
      });
    }

    // в•ђв•ђв•ђ CHECK TASKS LIMIT в•ђв•ђв•ђ
    if (action === 'check_tasks_limit') {
      const tasksToday = await getTasksCreatedToday(userId);
      const status = await getUserPremiumStatus(userId);
      const plan = PREMIUM_PLANS[status.currentPlan];
      const canCreate = tasksToday < plan.tasksPerDay;

      return res.status(200).json({
        ok: true,
        canCreate,
        tasksToday,
        limit: plan.tasksPerDay,
        remaining: Math.max(0, plan.tasksPerDay - tasksToday),
      });
    }

    // в•ђв•ђв•ђ GET COMMISSION в•ђв•ђв•ђ
    if (action === 'get_commission') {
      const status = await getUserPremiumStatus(userId);
      const commission = PREMIUM_PLANS[status.currentPlan].commissionPercent;

      return res.status(200).json({
        ok: true,
        commissionPercent: commission,
        currentPlan: status.currentPlan,
      });
    }

    // в•ђв•ђв•ђ ACTIVATE (THIS WOULD BE CALLED FROM PAYMENT HANDLER) в•ђв•ђв•ђ
    if (action === 'activate') {
      // Р’ СЂРµР°Р»СЊРЅРѕР№ СЃРёСЃС‚РµРјРµ СЌРЅРґРїРѕРёРЅС‚ Р±СѓРґРµС‚ РІС‹Р·РІР°РЅ РёР· РѕР±СЂР°Р±РѕС‚С‡РёРєР° РїР»Р°С‚РµР¶Р°
      const { plan = 'basic', days = 30 } = req.body;

      if (!PREMIUM_PLANS[plan]) {
        return res.status(400).json({ error: 'Invalid plan' });
      }

      await activatePremium(userId, plan, days);
      const status = await getUserPremiumStatus(userId);

      return res.status(200).json({
        ok: true,
        message: `РђРєС‚РёРІРёСЂРѕРІР°РЅР° РїРѕРґРїРёСЃРєР° ${plan}`,
        status,
      });
    }

    // в•ђв•ђв•ђ CANCEL в•ђв•ђв•ђ
    if (action === 'cancel') {
      await cancelPremium(userId);

      return res.status(200).json({
        ok: true,
        message: 'РџРѕРґРїРёСЃРєР° РѕС‚РјРµРЅРµРЅР°',
      });
    }

    // в•ђв•ђв•ђ GET STATS (ADMIN ONLY) в•ђв•ђв•ђ
    if (action === 'stats') {
      // TODO: РџСЂРѕРІРµСЂРёС‚СЊ С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р°РґРјРёРЅ
      const stats = await getPremiumStats();

      return res.status(200).json({
        ok: true,
        stats,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('app-premium error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
