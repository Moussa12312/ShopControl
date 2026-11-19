import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createShopSchema,
  requestShopTypeExpansionSchema,
  updateShopSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CreateShopPayload, ShopsService } from './shops.service';

@ApiTags('Boutiques')
@Controller()
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get('public/shops/:slug/status')
  @Public()
  @ApiOperation({ summary: 'Statut public d’une vitrine boutique et résolution des anciens slugs' })
  getPublicStatus(@Param('slug') slug: string) {
    return this.shopsService.getPublicShopStatus(slug);
  }

  @Get('shops')
  @ApiBearerAuth()
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les boutiques accessibles à l’utilisateur connecté' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.shopsService.listShopsForUser(user);
  }

  @Post('shops')
  @ApiBearerAuth()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Créer une nouvelle boutique et provisionner automatiquement sa base PostgreSQL dédiée' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createShopSchema)) body: CreateShopPayload,
    @Req() req: RequestWithAuth,
  ) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    return this.shopsService.createShopForMerchant(
      user.merchantId,
      body,
      { userId: user.userId, role: 'OWNER' },
      {
        ipAddress: req.ip || null,
        userAgent: req.header('user-agent') || null,
        correlationId: req.correlationId || null,
      },
    );
  }

  @Get('shops/:shopId')
  @ApiBearerAuth()
  @Roles('OWNER', 'AGENT')
  @UseGuards(ShopScopeGuard)
  @ApiOperation({ summary: 'Consulter les paramètres détaillés d’une boutique' })
  getOne(@Param('shopId') shopId: string) {
    return this.shopsService.getShopDetails(shopId);
  }

  @Patch('shops/:shopId')
  @ApiBearerAuth()
  @Roles('OWNER')
  @UseGuards(ShopScopeGuard)
  @ApiOperation({ summary: 'Modifier les paramètres d’une boutique (avec redirection auto en cas de changement de slug)' })
  update(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(updateShopSchema)) body: Partial<CreateShopPayload>,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.shopsService.updateShop(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('shops/:shopId/overview')
  @ApiBearerAuth()
  @Roles('OWNER', 'AGENT')
  @UseGuards(ShopScopeGuard)
  @ApiOperation({ summary: 'Synthèse réelle d’une boutique depuis sa base de données dédiée' })
  overview(@Param('shopId') shopId: string) {
    return this.shopsService.getShopOverview(shopId);
  }

  @Post('shops/:shopId/request-shop-type')
  @ApiBearerAuth()
  @Roles('OWNER')
  @UseGuards(ShopScopeGuard)
  @ApiOperation({ summary: 'Demander au Super Admin l’ajout d’un nouveau type de boutique / rayon' })
  requestShopTypeExpansion(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(requestShopTypeExpansionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.shopsService.requestShopTypeExpansion(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}
