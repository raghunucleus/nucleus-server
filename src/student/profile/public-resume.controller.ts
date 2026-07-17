import { Controller, Get, Ip, Param, Redirect } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentResumeService } from './student-resume.service';

/**
 * The PERMANENT public resume link — deliberately unauthenticated (HRs open
 * it from job applications, no account). Safety model: the token is a
 * 192-bit crypto-random secret unique per student (unguessable, revocable by
 * support only in extremis), the route is per-IP and per-token rate limited,
 * unknown/removed resumes 404, and the redirect target is a short-lived
 * presigned URL — the bucket itself stays fully private.
 */
@ApiTags('public')
@Controller('public/resumes')
export class PublicResumeController {
  constructor(private readonly resumes: StudentResumeService) {}

  @Get(':token')
  @Redirect(undefined, 302)
  @ApiOperation({
    summary:
      "Download a student's resume via their permanent share token. Redirects " +
      'to a short-lived file URL; 404 when no resume exists.',
  })
  async download(
    @Param('token') token: string,
    @Ip() ip: string,
  ): Promise<{ url: string }> {
    return { url: await this.resumes.resolvePublicDownload(token, ip) };
  }
}
