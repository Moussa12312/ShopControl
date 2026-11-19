import * as crypto from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignConversationSchema,
  createConversationSchema,
  sendMessageSchema,
  startPublicChatSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { NotificationsService } from '../notifications/notifications.module';

function stripSuspiciousLinks(text: string): string {
  // Section 8.10 : filtrage des liens externes dans la messagerie client publique
  return text.replace(/https?:\/\/\S+/gi, '[lien masqué]');
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listConversations(user: AuthenticatedUser, shopIdFilter?: string) {
    const where: Record<string, unknown> = {};

    if (user.role === 'SUPER_ADMIN') {
      where.type = 'SUPPORT_ADMIN_OWNER';
    } else if (user.role === 'OWNER') {
      if (!user.merchantId) return [];
      where.merchantId = user.merchantId;
      if (shopIdFilter && shopIdFilter !== 'ALL') {
        where.shopId = shopIdFilter;
      }
    } else if (user.role === 'AGENT') {
      const shopId = user.shopAccesses[0]?.shopId;
      if (!shopId) return [];
      where.shopId = shopId;
      where.type = { in: ['INTERNAL_OWNER_AGENT', 'CLIENT_SHOP'] };
    } else {
      return [];
    }

    const convs = await this.controlPrisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      include: {
        shop: { select: { id: true, name: true } },
        merchant: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { isRead: false } } } },
      },
    });

    return convs.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      subject: c.subject,
      shopId: c.shopId,
      shopName: c.shop?.name ?? null,
      merchantId: c.merchantId,
      merchantName: c.merchant.name,
      clientName: c.clientName,
      clientPhone: c.clientPhone,
      orderNumber: c.orderNumber,
      assignedAgentUserId: c.assignedAgentUserId,
      unreadCount: c._count.messages,
      lastMessage: c.messages[0]
        ? {
            body: c.messages[0].body,
            senderName: c.messages[0].senderName,
            senderRole: c.messages[0].senderRole,
            createdAt: c.messages[0].createdAt.toISOString(),
          }
        : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    }));
  }

  private async assertCanAccessConversation(convId: string, user: AuthenticatedUser) {
    const conv = await this.controlPrisma.conversation.findUnique({
      where: { id: convId },
      include: { shop: { select: { id: true, name: true } } },
    });
    if (!conv) {
      throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation introuvable.' });
    }
    if (user.role === 'SUPER_ADMIN') {
      if (conv.type !== 'SUPPORT_ADMIN_OWNER') {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Accès non autorisé.' });
      }
      return conv;
    }
    if (user.role === 'OWNER') {
      if (conv.merchantId !== user.merchantId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Conversation hors de votre entreprise.' });
      }
      return conv;
    }
    if (user.role === 'AGENT') {
      const myShopId = user.shopAccesses[0]?.shopId;
      if (!myShopId || conv.shopId !== myShopId || conv.type === 'SUPPORT_ADMIN_OWNER') {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Conversation hors de votre boutique.' });
      }
      return conv;
    }
    throw new ForbiddenException();
  }

  async getConversation(convId: string, user: AuthenticatedUser) {
    const conv = await this.assertCanAccessConversation(convId, user);

    // Marque les messages entrants comme lus
    await this.controlPrisma.message.updateMany({
      where: { conversationId: conv.id, senderUserId: { not: user.userId }, isRead: false },
      data: { isRead: true },
    });

    const messages = await this.controlPrisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      id: conv.id,
      type: conv.type,
      status: conv.status,
      subject: conv.subject,
      shopId: conv.shopId,
      shopName: conv.shop?.name ?? null,
      clientName: conv.clientName,
      clientPhone: conv.clientPhone,
      orderNumber: conv.orderNumber,
      assignedAgentUserId: conv.assignedAgentUserId,
      messages: messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async createConversation(input: any, actor: AuthenticatedUser) {
    let merchantId = actor.merchantId;
    let shopId: string | null = input.shopId || null;

    if (actor.role === 'SUPER_ADMIN') {
      if (input.type !== 'SUPPORT_ADMIN_OWNER' || !input.merchantId) {
        throw new BadRequestException('Sélectionnez le marchand destinataire.');
      }
      merchantId = input.merchantId;
      shopId = null;
    } else if (actor.role === 'AGENT') {
      const myShopId = actor.shopAccesses[0]?.shopId;
      if (!myShopId) throw new ForbiddenException('Boutique introuvable.');
      shopId = myShopId;
    } else if (actor.role === 'OWNER') {
      if (shopId && !actor.shopAccesses.some((s) => s.shopId === shopId)) {
        throw new ForbiddenException('Boutique invalide.');
      }
    }

    if (!merchantId) throw new ForbiddenException('Marchand manquant.');

    const conv = await this.controlPrisma.conversation.create({
      data: {
        merchantId,
        shopId,
        type: input.type,
        subject: input.subject,
        clientName: input.clientName || null,
        clientPhone: input.clientPhone || null,
        orderId: input.orderId || null,
        orderNumber: input.orderNumber || null,
        clientSecretToken: input.type === 'CLIENT_SHOP' ? crypto.randomBytes(24).toString('hex') : null,
        lastMessageAt: new Date(),
        messages: {
          create: {
            senderRole: actor.role,
            senderUserId: actor.userId,
            senderName: actor.fullName,
            body: input.initialMessage,
            isRead: false,
          },
        },
      },
      include: { messages: true },
    });

    await this.notifyParticipants(conv, actor.userId, actor.fullName, input.initialMessage);
    return conv;
  }

  async sendMessage(
    convId: string,
    input: { body: string; attachmentUrl?: string | null },
    actor: AuthenticatedUser,
  ) {
    const conv = await this.assertCanAccessConversation(convId, actor);

    const msg = await this.controlPrisma.message.create({
      data: {
        conversationId: conv.id,
        senderRole: actor.role,
        senderUserId: actor.userId,
        senderName: actor.fullName,
        body: input.body,
        attachmentUrl: input.attachmentUrl || null,
        isRead: false,
      },
    });

    await this.controlPrisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date() },
    });

    await this.notifyParticipants(conv, actor.userId, actor.fullName, input.body);
    return { ...msg, createdAt: msg.createdAt.toISOString() };
  }

  async assignConversation(convId: string, agentUserId: string | null, actor: AuthenticatedUser) {
    const conv = await this.assertCanAccessConversation(convId, actor);
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Seul le propriétaire peut attribuer une conversation.');
    }
    return this.controlPrisma.conversation.update({
      where: { id: conv.id },
      data: { assignedAgentUserId: agentUserId },
    });
  }

  // --- Messagerie publique Client <-> Boutique (Critères #9 & #10) ---
  async startOrResumePublicChat(
    slug: string,
    input: { clientName: string; clientPhone: string; orderSecretToken?: string; message: string },
  ) {
    const shop = await this.controlPrisma.shop.findUnique({ where: { slug: slug.trim().toLowerCase() } });
    if (!shop) throw new NotFoundException('Boutique introuvable.');

    const cleanBody = stripSuspiciousLinks(input.message);
    let orderId: string | null = null;
    let orderNumber: string | null = null;

    if (input.orderSecretToken) {
      const shopClient = await this.shopDbManager.getClientForShop(shop.id);
      const ord = await shopClient.onlineOrder.findUnique({
        where: { secretToken: input.orderSecretToken },
        select: { id: true, orderNumber: true },
      });
      if (ord) {
        orderId = ord.id;
        orderNumber = ord.orderNumber;
      }
    }

    const secretToken = crypto.randomBytes(24).toString('hex');
    const conv = await this.controlPrisma.conversation.create({
      data: {
        merchantId: shop.merchantId,
        shopId: shop.id,
        type: 'CLIENT_SHOP',
        subject: orderNumber
          ? `Commande ${orderNumber} — ${input.clientName}`
          : `Question client — ${input.clientName}`,
        clientName: input.clientName,
        clientPhone: input.clientPhone,
        orderId,
        orderNumber,
        clientSecretToken: secretToken,
        lastMessageAt: new Date(),
        messages: {
          create: {
            senderRole: 'CLIENT',
            senderName: input.clientName,
            body: cleanBody,
            isRead: false,
          },
        },
      },
      include: { messages: true },
    });

    // Notifie Propriétaire (même sans Agent — Critère #9) et Agents de cette boutique (Critère #10)
    await this.notifyParticipants(conv, null, input.clientName, cleanBody);

    return {
      conversationId: conv.id,
      chatToken: secretToken,
      messages: conv.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    };
  }

  async getPublicChat(slug: string, token: string) {
    const conv = await this.controlPrisma.conversation.findUnique({
      where: { clientSecretToken: token },
      include: {
        shop: { select: { slug: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv || conv.shop?.slug !== slug.trim().toLowerCase()) {
      throw new NotFoundException('Conversation introuvable.');
    }
    return {
      id: conv.id,
      subject: conv.subject,
      shopName: conv.shop.name,
      messages: conv.messages.map((m) => ({
        id: m.id,
        senderRole: m.senderRole,
        senderName: m.senderName,
        body: m.body,
        attachmentUrl: m.attachmentUrl,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async postPublicChatMessage(slug: string, token: string, body: string) {
    const conv = await this.controlPrisma.conversation.findUnique({
      where: { clientSecretToken: token },
      include: { shop: { select: { slug: true, id: true } } },
    });
    if (!conv || conv.shop?.slug !== slug.trim().toLowerCase()) {
      throw new NotFoundException('Conversation introuvable.');
    }
    const cleanBody = stripSuspiciousLinks(body);
    const msg = await this.controlPrisma.message.create({
      data: {
        conversationId: conv.id,
        senderRole: 'CLIENT',
        senderName: conv.clientName || 'Client',
        body: cleanBody,
        isRead: false,
      },
    });
    await this.controlPrisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date() },
    });
    await this.notifyParticipants(conv, null, conv.clientName || 'Client', cleanBody);
    return { ...msg, createdAt: msg.createdAt.toISOString() };
  }

  private async notifyParticipants(
    conv: { id: string; merchantId: string; shopId: string | null; type: string; subject: string },
    excludeUserId: string | null,
    senderName: string,
    body: string,
  ) {
    const preview = body.slice(0, 120);
    if (conv.type === 'SUPPORT_ADMIN_OWNER') {
      const recipients = await this.controlPrisma.user.findMany({
        where: {
          isActive: true,
          OR: [{ role: 'SUPER_ADMIN' }, { merchantId: conv.merchantId, role: 'OWNER' }],
        },
        select: { id: true },
      });
      for (const r of recipients) {
        if (r.id === excludeUserId) continue;
        await this.notificationsService.create({
          merchantId: conv.merchantId,
          recipientUserId: r.id,
          type: 'MESSAGING',
          priority: 'INFO',
          title: `Message : ${conv.subject}`,
          message: `${senderName} : ${preview}`,
          targetPath: `/messaging?c=${conv.id}`,
        });
      }
      return;
    }

    // Propriétaire(s)
    const owners = await this.controlPrisma.user.findMany({
      where: { merchantId: conv.merchantId, role: 'OWNER', isActive: true },
      select: { id: true },
    });
    for (const o of owners) {
      if (o.id === excludeUserId) continue;
      await this.notificationsService.create({
        merchantId: conv.merchantId,
        shopId: conv.shopId,
        recipientUserId: o.id,
        type: 'MESSAGING',
        priority: 'INFO',
        title: `Message : ${conv.subject}`,
        message: `${senderName} : ${preview}`,
        targetPath: `/messaging?c=${conv.id}`,
      });
    }

    // Agents de cette boutique uniquement
    if (conv.shopId) {
      const agents = await this.controlPrisma.userShopAccess.findMany({
        where: { shopId: conv.shopId, isActive: true, user: { role: 'AGENT', isActive: true } },
        select: { userId: true },
      });
      for (const a of agents) {
        if (a.userId === excludeUserId) continue;
        await this.notificationsService.create({
          merchantId: conv.merchantId,
          shopId: conv.shopId,
          recipientUserId: a.userId,
          type: 'MESSAGING',
          priority: 'INFO',
          title: `Message : ${conv.subject}`,
          message: `${senderName} : ${preview}`,
          targetPath: `/messaging?c=${conv.id}`,
        });
      }
    }
  }
}

@ApiTags('Messagerie (Lot 6)')
@Controller()
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('messaging/conversations')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  @ApiOperation({ summary: 'Boîte de réception unifiée scopée par rôle et boutique' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('shopId') shopId?: string) {
    return this.messagingService.listConversations(user, shopId);
  }

  @Post('messaging/conversations')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  @ApiOperation({ summary: 'Ouvrir une conversation (Propriétaire↔Agent, Boutique↔Client, Support)' })
  create(
    @Body(new ZodValidationPipe(createConversationSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messagingService.createConversation(body, user);
  }

  @Get('messaging/conversations/:id')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messagingService.getConversation(id, user);
  }

  @Post('messaging/conversations/:id/messages')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  sendMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: { body: string; attachmentUrl?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messagingService.sendMessage(id, body, user);
  }

  @Patch('messaging/conversations/:id/assign')
  @ApiBearerAuth()
  @Roles('OWNER')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignConversationSchema)) body: { assignedAgentUserId: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messagingService.assignConversation(id, body.assignedAgentUserId, user);
  }

  // --- Guest Chat Public ---
  @Post('public/shops/:slug/chat/start')
  @Public()
  startPublicChat(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(startPublicChatSchema)) body: any,
  ) {
    return this.messagingService.startOrResumePublicChat(slug, body);
  }

  @Get('public/shops/:slug/chat/:token')
  @Public()
  getPublicChat(@Param('slug') slug: string, @Param('token') token: string) {
    return this.messagingService.getPublicChat(slug, token);
  }

  @Post('public/shops/:slug/chat/:token/messages')
  @Public()
  postPublicChatMessage(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: { body: string },
  ) {
    return this.messagingService.postPublicChatMessage(slug, token, body.body);
  }
}

@Module({
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
