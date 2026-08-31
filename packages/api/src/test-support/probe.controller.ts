import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { DbClient } from '@scriptorium/database/client';
import {
  assertOwnership,
  type AuthenticatedUser,
  CurrentUser,
  DB,
} from '@scriptorium/server-core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Test-only routes. `#21` ships no owned-resource endpoints of its own, but
// the ownership `404` rule and the `422` / `400` validation split are
// cross-cutting concerns that land in this slice, so the Seam 1 suite needs a
// route to exercise them against. Mounted only by the test app factory.
class EchoDto extends createZodDto(
  z.object({ name: z.string().min(1).max(10) }),
) {}

@Controller('_probe')
export class ProbeController {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  @Get('books/:id')
  async getBook(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const pool = (this.db as unknown as { $client: Pool }).$client;
    const { rows } = await pool.query(
      'SELECT id, user_id FROM books WHERE id = $1',
      [id],
    );
    const book = rows[0]
      ? { id: rows[0].id as string, userId: rows[0].user_id as string }
      : undefined;
    return assertOwnership(book, caller.id, 'book_not_found');
  }

  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }
}

interface Pool {
  query: (
    text: string,
    values: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}
