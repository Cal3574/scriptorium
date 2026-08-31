import { Controller, Get, InternalServerErrorException } from '@nestjs/common';
import { UserDto } from '@scriptorium/contracts';
import {
  type AuthenticatedUser,
  CurrentUser,
  UsersRepository,
} from '@scriptorium/server-core';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersRepository) {}

  // The client calls this once on first authenticated load to learn its local
  // identity. The guard has already provisioned the row.
  @Get()
  async me(@CurrentUser() caller: AuthenticatedUser): Promise<UserDto> {
    const row = await this.users.findById(caller.id);
    if (!row) {
      // The guard just upserted this id; a miss here is a serious bug.
      throw new InternalServerErrorException('authenticated user has no row');
    }
    return UserDto.parse({
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
