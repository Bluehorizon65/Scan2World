import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AppError } from '../common/app-error';
import { env } from '../env';
import { PrismaService } from '../prisma.service';
import { CurrentUser, Public, SESSION_COOKIE, type SessionUser } from './auth.guard';

class CredentialsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

const SESSION_DAYS = 7;
const authLimit = () => ({ default: { limit: Number(process.env.AUTH_RATE_LIMIT ?? 20), ttl: 60_000 } });
const publicUser = (u: { id: string; email: string; role: string; createdAt: Date }) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  @Public()
  @Throttle(authLimit())
  @Post('register')
  async register(@Body() dto: CredentialsDto, @Res({ passthrough: true }) res: Response) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } }))
      throw new AppError(409, 'email_taken', 'An account with this email already exists');
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) },
    });
    await this.startSession(res, user.id);
    return { user: publicUser(user) };
  }

  @Public()
  @Throttle(authLimit())
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: CredentialsDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password)))
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
    await this.startSession(res, user.id);
    return { user: publicUser(user) };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  async me(@CurrentUser() session: SessionUser) {
    const user = await this.prisma.user.findUnique({ where: { id: session.id } });
    if (!user) throw new AppError(401, 'unauthorized', 'Account no longer exists');
    return { user: publicUser(user) };
  }

  private async startSession(res: Response, userId: string) {
    const token = await this.jwt.signAsync({ sub: userId }, { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.secureCookies,
      path: '/',
      maxAge: SESSION_DAYS * 86_400_000,
    });
  }
}
