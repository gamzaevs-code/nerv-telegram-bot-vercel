import prisma from '../lib/prisma-client.js';

// Тарифы
export const PREMIUM_PLANS = {
  free: {
    name: 'Бесплатно',
    price: 0,
    tasksPerDay: 5,
    commissionPercent: 20,
    features: ['Базовые задания', 'Базовый чат'],
  },
  basic: {
    name: 'Базовая',
    price: 299, // в копейках (2.99$)
    currency: 'RUB',
    rublePrice: 249,
    tasksPerDay: 15,
    commissionPercent: 10,
    features: ['Больше задач', 'Без рекламы', 'Расширенные фильтры'],
  },
  premium: {
    name: 'Premium',
    price: 999, // в копейках (9.99$)
    currency: 'RUB',
    rublePrice: 799,
    tasksPerDay: 50,
    commissionPercent: 5,
    features: ['Неограниченные задачи', 'Приоритет', 'Аналитика', 'Приоритетная поддержка'],
  },
  vip: {
    name: 'VIP',
    price: 2999, // в копейках (29.99$)
    currency: 'RUB',
    rublePrice: 2399,
    tasksPerDay: 999,
    commissionPercent: 0,
    features: ['ВСЁ', 'Специальный значок', 'Прямая поддержка', 'Пользовательский значок'],
  },
};

/**
 * Получить статус подписки пользователя
 */
export async function getUserPremiumStatus(userId) {
  try {
    if (!userId) throw new Error('Missing userId');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        premiumPlan: true,
        premiumExpireAt: true,
      },
    });

    if (!user) throw new Error('User not found');

    const plan = user.premiumPlan || 'free';
    const isExpired = user.premiumExpireAt && new Date(user.premiumExpireAt) < new Date();

    return {
      userId,
      currentPlan: isExpired ? 'free' : plan,
      expireAt: isExpired ? null : user.premiumExpireAt,
      isActive: !isExpired && plan !== 'free',
      planInfo: PREMIUM_PLANS[isExpired ? 'free' : plan],
    };
  } catch (e) {
    console.error('getUserPremiumStatus error:', e);
    throw e;
  }
}

/**
 * Активировать премиум подписку
 */
export async function activatePremium(userId, plan, daysCount = 30) {
  try {
    if (!userId || !plan) throw new Error('Missing userId or plan');
    if (!PREMIUM_PLANS[plan]) throw new Error('Invalid plan');

    const expireAt = new Date();
    expireAt.setDate(expireAt.getDate() + daysCount);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        premiumPlan: plan,
        premiumExpireAt: expireAt,
      },
    });

    return {
      ok: true,
      plan,
      expireAt,
      daysCount,
    };
  } catch (e) {
    console.error('activatePremium error:', e);
    throw e;
  }
}

/**
 * Отменить премиум подписку
 */
export async function cancelPremium(userId) {
  try {
    if (!userId) throw new Error('Missing userId');

    await prisma.user.update({
      where: { id: userId },
      data: {
        premiumPlan: 'free',
        premiumExpireAt: null,
      },
    });

    return { ok: true };
  } catch (e) {
    console.error('cancelPremium error:', e);
    throw e;
  }
}

/**
 * Получить комиссию для пользователя
 */
export async function getUserCommissionPercent(userId) {
  try {
    const status = await getUserPremiumStatus(userId);
    return PREMIUM_PLANS[status.currentPlan].commissionPercent;
  } catch (e) {
    console.error('getUserCommissionPercent error:', e);
    return PREMIUM_PLANS.free.commissionPercent;
  }
}

/**
 * Проверить лимит задач в день
 */
export async function checkTasksPerDayLimit(userId, createdTasksToday) {
  try {
    const status = await getUserPremiumStatus(userId);
    const limit = PREMIUM_PLANS[status.currentPlan].tasksPerDay;
    return createdTasksToday < limit;
  } catch (e) {
    console.error('checkTasksPerDayLimit error:', e);
    return createdTasksToday < PREMIUM_PLANS.free.tasksPerDay;
  }
}

/**
 * Получить количество созданных задач сегодня
 */
export async function getTasksCreatedToday(userId) {
  try {
    if (!userId) throw new Error('Missing userId');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.task.count({
      where: {
        creatorId: userId,
        createdAt: {
          gte: today,
        },
      },
    });

    return count;
  } catch (e) {
    console.error('getTasksCreatedToday error:', e);
    return 0;
  }
}

/**
 * Проверить есть ли у пользователя функция
 */
export async function hasFeature(userId, featureName) {
  try {
    const status = await getUserPremiumStatus(userId);
    const features = PREMIUM_PLANS[status.currentPlan].features;
    return features.includes(featureName);
  } catch (e) {
    console.error('hasFeature error:', e);
    return false;
  }
}

/**
 * Получить все активные премиум подписки
 */
export async function getActivePremiumUsers(limit = 100) {
  try {
    const users = await prisma.user.findMany({
      where: {
        premiumPlan: { not: 'free' },
        premiumExpireAt: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        name: true,
        premiumPlan: true,
        premiumExpireAt: true,
      },
      take: limit,
      orderBy: { premiumExpireAt: 'desc' },
    });

    return users;
  } catch (e) {
    console.error('getActivePremiumUsers error:', e);
    return [];
  }
}

/**
 * Получить статистику премиум пользователей
 */
export async function getPremiumStats() {
  try {
    const total = await prisma.user.count();
    const premium = await prisma.user.count({
      where: {
        premiumPlan: { not: 'free' },
        premiumExpireAt: { gt: new Date() },
      },
    });

    const byPlan = await prisma.user.groupBy({
      by: ['premiumPlan'],
      _count: true,
      where: {
        premiumExpireAt: { gt: new Date() },
      },
    });

    return {
      totalUsers: total,
      premiumUsers: premium,
      premiumPercent: Math.round((premium / total) * 100),
      byPlan: Object.fromEntries(
        byPlan.map(p => [p.premiumPlan, p._count])
      ),
    };
  } catch (e) {
    console.error('getPremiumStats error:', e);
    return null;
  }
}
