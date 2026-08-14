import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AppConfig } from '../../config/configuration';
import {
  buildAuctionWonEmailHtml,
  buildNewOrderReceivedEmailHtml,
  buildOrderStatusUpdateEmailHtml,
  buildOrderStatusUpdateEmailSubject,
  buildPaymentReceiptEmailHtml,
  type AuctionWonData,
  type NewOrderReceivedData,
  type OrderStatusUpdateData,
  type PaymentReceiptData,
} from './templates';

// Same graceful-degradation shape as MeilisearchService: an unconfigured
// RESEND_API_KEY (e.g. local dev, CI) must never crash the app or block
// checkout — it's a best-effort notification, not a source of truth (see
// backend.md's Meilisearch/WebSocket rule; email is the same kind of
// thing — Postgres already recorded the order before this ever runs).
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const apiKey = configService.get('email.resendApiKey', { infer: true });
    this.fromEmail = configService.get('email.fromEmail', { infer: true });
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendPaymentReceipt(
    to: string,
    receipt: PaymentReceiptData,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn({
        event: 'email.resend_not_configured',
        orderId: receipt.orderId,
      });
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: `Payment received — Order #${receipt.orderId.slice(0, 8)}`,
      html: buildPaymentReceiptEmailHtml(receipt),
    });

    if (error) {
      this.logger.warn({
        event: 'email.send_rejected',
        orderId: receipt.orderId,
        error,
      });
    }
  }

  async sendOrderStatusUpdate(
    to: string,
    data: OrderStatusUpdateData,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn({
        event: 'email.resend_not_configured',
        orderId: data.orderId,
      });
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: buildOrderStatusUpdateEmailSubject(data),
      html: buildOrderStatusUpdateEmailHtml(data),
    });

    if (error) {
      this.logger.warn({
        event: 'email.send_rejected',
        orderId: data.orderId,
        error,
      });
    }
  }

  async sendNewOrderReceived(
    to: string,
    data: NewOrderReceivedData,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn({
        event: 'email.resend_not_configured',
        orderId: data.orderId,
      });
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: `You've got a new order — Order #${data.orderId.slice(0, 8)}`,
      html: buildNewOrderReceivedEmailHtml(data),
    });

    if (error) {
      this.logger.warn({
        event: 'email.send_rejected',
        orderId: data.orderId,
        error,
      });
    }
  }

  async sendAuctionWon(to: string, data: AuctionWonData): Promise<void> {
    if (!this.resend) {
      this.logger.warn({
        event: 'email.resend_not_configured',
        auctionId: data.auctionId,
      });
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: `You won the auction for "${data.productName}"`,
      html: buildAuctionWonEmailHtml(data),
    });

    if (error) {
      this.logger.warn({
        event: 'email.send_rejected',
        auctionId: data.auctionId,
        error,
      });
    }
  }
}
