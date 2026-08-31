import { Controller, Get } from '@nestjs/common';
import { Public } from '@scriptorium/server-core';

// The one route outside the `/api/v1` prefix and the auth guard - infra
// liveness checks must not depend on the version segment or a token.
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
