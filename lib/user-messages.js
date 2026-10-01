import prisma from '../lib/prisma-client.js';

/**
 * Отправить личное сообщение
 */
export async function sendUserMessage(fromUserId, toUserId, text) {
  try {
    // Проверки
    if (!fromUserId || !toUserId || !text) {
      throw new Error('Missing required fields');
    }
    if (fromUserId === toUserId) {
      throw new Error('Cannot send message to yourself');
    }
    if (text.length > 2000) {
      throw new Error('Message too long (max 2000 chars)');
    }

    // Создать сообщение
    const message = await prisma.message.create({
      data: {
        fromUserId,
        toUserId,
        text: text.trim(),
      },
    });

    return message;
  } catch (e) {
    console.error('sendUserMessage error:', e);
    throw e;
  }
}

/**
 * Получить историю сообщений с пользователем
 */
export async function getUserMessageHistory(userId, otherId, limit = 50) {
  try {
    if (!userId || !otherId) {
      throw new Error('Missing user IDs');
    }

    // Получить сообщения (в обе стороны)
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { fromUserId: userId, toUserId: otherId },
          { fromUserId: otherId, toUserId: userId },
        ],
      },
      include: {
        fromUser: { select: { id: true, displayName: true, name: true } },
        toUser: { select: { id: true, displayName: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    // Добавить флаг "это мое"
    const messagesWithMine = messages.map(m => ({
      ...m,
      isMine: m.fromUserId === userId,
      fromName: m.fromUser.displayName || m.fromUser.name,
      toName: m.toUser.displayName || m.toUser.name,
    }));

    return messagesWithMine;
  } catch (e) {
    console.error('getUserMessageHistory error:', e);
    throw e;
  }
}

/**
 * Получить список всех активных диалогов для пользователя
 */
export async function getUserConversations(userId, limit = 50) {
  try {
    if (!userId) throw new Error('Missing userId');

    // Получить все чаты (последнее сообщение из каждого)
    const conversations = await prisma.message.findMany({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      include: {
        fromUser: { select: { id: true, displayName: true, name: true } },
        toUser: { select: { id: true, displayName: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // Берём больше чтобы дедупликировать
    });

    // Дедупликировать (оставить только последнее сообщение с каждым пользователем)
    const seenUsers = new Set();
    const unique = [];
    for (const msg of conversations) {
      const otherId = msg.fromUserId === userId ? msg.toUserId : msg.fromUserId;
      if (!seenUsers.has(otherId)) {
        seenUsers.add(otherId);
        unique.push({
          id: otherId,
          name: msg.fromUserId === userId ? msg.toUser.displayName || msg.toUser.name : msg.fromUser.displayName || msg.fromUser.name,
          lastMessage: msg.text,
          lastMessageAt: msg.createdAt,
          isRead: msg.isRead,
        });
      }
    }

    return unique.slice(0, limit);
  } catch (e) {
    console.error('getUserConversations error:', e);
    throw e;
  }
}

/**
 * Получить количество непрочитанных сообщений
 */
export async function getUnreadMessageCount(userId) {
  try {
    if (!userId) throw new Error('Missing userId');

    const count = await prisma.message.count({
      where: {
        toUserId: userId,
        isRead: false,
      },
    });

    return count;
  } catch (e) {
    console.error('getUnreadMessageCount error:', e);
    throw e;
  }
}

/**
 * Получить количество непрочитанных от конкретного пользователя
 */
export async function getUnreadCountFromUser(userId, fromUserId) {
  try {
    if (!userId || !fromUserId) throw new Error('Missing user IDs');

    const count = await prisma.message.count({
      where: {
        toUserId: userId,
        fromUserId: fromUserId,
        isRead: false,
      },
    });

    return count;
  } catch (e) {
    console.error('getUnreadCountFromUser error:', e);
    throw e;
  }
}

/**
 * Отметить сообщения как прочитанные
 */
export async function markMessagesAsRead(userId, fromUserId) {
  try {
    if (!userId || !fromUserId) throw new Error('Missing user IDs');

    await prisma.message.updateMany({
      where: {
        toUserId: userId,
        fromUserId: fromUserId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return true;
  } catch (e) {
    console.error('markMessagesAsRead error:', e);
    throw e;
  }
}
