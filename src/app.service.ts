import { Injectable } from '@nestjs/common';

/** Deployment marker — bump these by hand on each deploy. */
const LATEST_CODE_REVISION = '12 SEP  2026, 01:00 PM';

@Injectable()
export class AppService {
  getHello(): string {
    return `Hello From Nucleus! (CODE_UPDATED_ON : ${LATEST_CODE_REVISION})`;
  }
}
