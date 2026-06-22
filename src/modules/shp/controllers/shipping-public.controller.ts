import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/index.js';
import { ShipmentService } from '../services/shipment.service.js';
import { TrackingWebhookDto } from '../dto/shipment.dto.js';
import {
  verifyWebhookSignature,
  webhookMessage,
} from '../webhook-hmac.util.js';

/**
 * Public (un-authenticated) shipping surface:
 *  - carrier tracking webhooks (HMAC-verified, tenant resolved from carrier id),
 *  - the customer-facing tracking link (opaque token, no PII).
 *
 * These routes are @Public so the global JWT/Tenant/RBAC guards skip them; each
 * enforces its own access control (HMAC for the webhook, an unguessable token
 * for tracking).
 */
@ApiTags('Shipping — Public')
@Controller('api/v1/shipping')
export class ShippingPublicController {
  constructor(private readonly service: ShipmentService) {}

  @Public()
  @Post('webhooks/:carrierId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Carrier tracking webhook (HMAC-verified)' })
  @ApiResponse({ status: 200, description: 'Event accepted (or ignored)' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  async webhook(
    @Param('carrierId', ParseUUIDPipe) carrierId: string,
    @Headers('x-webhook-signature') signature: string,
    @Body() dto: TrackingWebhookDto,
  ) {
    const carrier = await this.service.resolveWebhookCarrier(carrierId);
    if (!carrier) throw new UnauthorizedException('SHP_WEBHOOK_UNVERIFIED');
    if (!carrier.webhookSecret) {
      // No secret configured ⇒ we cannot verify ⇒ refuse (fail closed).
      throw new UnauthorizedException('SHP_WEBHOOK_NO_SECRET');
    }
    const ok = verifyWebhookSignature(
      carrier.webhookSecret,
      webhookMessage(carrierId, dto),
      signature ?? '',
    );
    if (!ok) throw new UnauthorizedException('SHP_WEBHOOK_BAD_SIGNATURE');

    return this.service.applyTrackingUpdate(carrier.tenantId, carrierId, dto);
  }

  @Public()
  @Get('track/:token')
  @ApiOperation({ summary: 'Public shipment tracking by opaque token' })
  @ApiResponse({ status: 404, description: 'Unknown tracking token' })
  publicTrack(@Param('token') token: string) {
    return this.service.trackByToken(token);
  }
}
