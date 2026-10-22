import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { vendorGateway } from '../models/model-policies';

const internal = new Set(['actualProviderCost', 'simulatedProviderCost', 'providerInputRate', 'providerOutputRate', 'cachedInputRate', 'additionalFee', 'markupPercent', 'simulationInputRate', 'simulationOutputRate', 'grossMargin', 'simulatedGrossMargin', 'pricingSnapshot']);
/** Defense in depth for JSON responses, including nested model pricing and audit snapshots. */
export function customerResponse(value: unknown): unknown {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (key, item) => internal.has(key) ? undefined : item));
}
@Injectable()
export class VendorResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((value) => vendorGateway() ? customerResponse(value) : value));
  }
}
