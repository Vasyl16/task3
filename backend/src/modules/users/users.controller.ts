import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Ownership (self, or ADMIN) is enforced inside the service — see
  // UsersService.findByIdForCaller.
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() caller: AuthenticatedUser) {
    return this.usersService.findByIdForCaller(id, caller);
  }

  // Self only — see UsersService.updateForCaller.
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    return this.usersService.updateForCaller(id, dto, caller);
  }
}
