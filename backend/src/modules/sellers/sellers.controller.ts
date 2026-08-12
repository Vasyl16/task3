import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { ReviewSellerDto } from './dto/review-seller.dto';

// TODO(auth): apply() should take userId from the authenticated caller;
// review() must be restricted to ADMIN. Both currently trust the body.
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.sellersService.findById(id);
  }

  @Post('apply')
  apply(@Body() dto: ApplySellerDto) {
    return this.sellersService.apply(dto);
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewSellerDto) {
    return this.sellersService.review(id, dto);
  }
}
