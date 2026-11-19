import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  confirmTwoFactorSchema,
  loginSchema,
  verifyTwoFactorLoginSchema,
} from '@shopcontrol/shared';
import { getEnv } from '../../common/config/env.config';
import {
  AllowSuspendedWrite,
  CurrentUser,
  Public,
} from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion par e-mail et mot de passe (avec défi 2FA si activé)' })
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: { email: string; password: string; deviceName?: string },
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(body, this.extractMeta(req));
    if (!result.requiresTwoFactor) {
      this.setAuthCookies(res, result.accessToken, result.refreshToken, result.refreshTtlMs);
      return {
        requiresTwoFactor: false,
        accessToken: result.accessToken,
        user: result.user,
        merchant: result.merchant,
        shops: result.shops,
      };
    }
    return result;
  }

  @Post('2fa/verify-login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valider le code TOTP 2FA lors de la connexion' })
  async verifyTwoFactorLogin(
    @Body(new ZodValidationPipe(verifyTwoFactorLoginSchema))
    body: { challengeToken: string; code: string; deviceName?: string },
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyTwoFactorLogin(body, this.extractMeta(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken, result.refreshTtlMs);
    return {
      requiresTwoFactor: false,
      accessToken: result.accessToken,
      user: result.user,
      merchant: result.merchant,
      shops: result.shops,
    };
  }

  @Post('2fa/setup')
  @ApiBearerAuth()
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Initialiser la configuration 2FA (QR code TOTP)' })
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupTwoFactor(user);
  }

  @Post('2fa/confirm')
  @ApiBearerAuth()
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Confirmer et activer le 2FA avec un code 6 chiffres' })
  confirmTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(confirmTwoFactorSchema)) body: { code: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.authService.confirmTwoFactor(user, body.code, this.extractMeta(req));
  }

  @Post('2fa/disable')
  @ApiBearerAuth()
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Désactiver le 2FA (Propriétaire uniquement)' })
  disableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(confirmTwoFactorSchema)) body: { code: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.authService.disableTwoFactor(user, body.code, this.extractMeta(req));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouveler les jetons via rotation sécurisée du refresh token' })
  async refresh(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') bodyRefreshToken?: string,
  ) {
    const token = (req.cookies?.sc_refresh_token as string | undefined) || bodyRefreshToken;
    if (!token) {
      throw new UnauthorizedException({
        code: 'REFRESH_MISSING',
        message: 'Jeton de rafraîchissement manquant.',
      });
    }
    const result = await this.authService.refresh(token, this.extractMeta(req));
    this.setAuthCookies(res, result.accessToken, result.refreshToken, result.refreshTtlMs);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @ApiBearerAuth()
  @AllowSuspendedWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fermer la session active et révoquer le jeton' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user, this.extractMeta(req));
    this.clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtenir le profil complet, les boutiques accessibles et les permissions effectives' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lister les sessions actives de l’utilisateur' })
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.userId, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @ApiBearerAuth()
  @AllowSuspendedWrite()
  @ApiOperation({ summary: 'Révoquer à distance une session active' })
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.authService.revokeOwnSession(user, sessionId, this.extractMeta(req));
  }

  private extractMeta(req: RequestWithAuth) {
    return {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    };
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshTtlMs: number) {
    const env = getEnv();
    res.cookie('sc_access_token', accessToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
    });
    res.cookie('sc_refresh_token', refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: refreshTtlMs,
    });
  }

  private clearAuthCookies(res: Response) {
    const env = getEnv();
    res.clearCookie('sc_access_token', { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
    res.clearCookie('sc_refresh_token', {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }
}
