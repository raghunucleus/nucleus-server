import { Injectable } from '@nestjs/common';

/** Deployment marker — bump these by hand on each deploy. */
const LATEST_CODE_REVISION = '11 SEP  2026, 04:25 PM';

@Injectable()
export class AppService {
  getHello(): string {
    return `Hello From Nucleus! (CODE_UPDATED_ON : ${LATEST_CODE_REVISION})`;
  }
}
