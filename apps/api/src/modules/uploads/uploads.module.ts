import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { uploadImageSchema } from '@shopcontrol/shared';
import { Public, Roles } from '../../common/auth/auth.decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';

const MAX_BYTES = 5 * 1024 * 1024; // 5 Mo (Section 14.1)
const SAFE_FILENAME_RE = /^[a-z]+_[a-f0-9-]+\.(jpg|png|webp)$/;

function resolveUploadsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../uploads'),
    path.resolve(process.cwd(), 'uploads'),
  ];
  const target = fs.existsSync(path.resolve(process.cwd(), '../../package.json'))
    ? candidates[0]
    : candidates[1];
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

function detectImageTypeFromMagicBytes(buf: Buffer): { mime: string; ext: 'jpg' | 'png' | 'webp' } | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

@ApiTags('Médias & Uploads')
@Controller('uploads')
export class UploadsController {
  @Post('image')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'OWNER', 'AGENT')
  @ApiOperation({ summary: 'Téléverser une image sécurisée (produit, logo boutique ou pièce jointe photo)' })
  uploadImage(
    @Body(new ZodValidationPipe(uploadImageSchema))
    body: { dataUrl: string; purpose: 'product' | 'logo' | 'message' },
  ) {
    const match = body.dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new BadRequestException({
        code: 'INVALID_IMAGE_FORMAT',
        message: 'Format d’image non pris en charge. Utilisez JPEG, PNG ou WebP.',
      });
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      throw new BadRequestException({
        code: 'IMAGE_TOO_LARGE',
        message: 'L’image dépasse la taille maximale autorisée (5 Mo).',
      });
    }

    const detected = detectImageTypeFromMagicBytes(buffer);
    if (!detected) {
      throw new BadRequestException({
        code: 'INVALID_IMAGE_CONTENT',
        message: 'Le fichier envoyé n’est pas une image JPEG, PNG ou WebP valide.',
      });
    }

    const dir = resolveUploadsDir();
    const filename = `${body.purpose}_${crypto.randomUUID()}.${detected.ext}`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, buffer);

    return {
      url: `/api/v1/uploads/${filename}`,
      filename,
      mimeType: detected.mime,
      sizeBytes: buffer.length,
    };
  }

  @Get(':filename')
  @Public()
  @ApiOperation({ summary: 'Servir une image téléversée (logo boutique ou photo produit)' })
  getImage(@Param('filename') filename: string, @Res() res: Response) {
    if (!SAFE_FILENAME_RE.test(filename)) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    }
    const dir = resolveUploadsDir();
    const fullPath = path.join(dir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Image introuvable.' });
    }

    const ext = filename.split('.').pop();
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(fullPath);
  }
}

@Module({
  controllers: [UploadsController],
})
export class UploadsModule {}
