import { ApiProperty } from '@nestjs/swagger';
import { PricingStrategy } from '@prisma/client';
import { DATE, DECIMAL, NULLABLE_DECIMAL, NULLABLE_STRING } from '../common/swagger/schema-types';
import { AIModelView } from '../models/models.schemas';

export class PricingVersionView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) configurationId!: string;
  @ApiProperty({ example: 2 }) version!: number;
  @ApiProperty({ enum: PricingStrategy }) strategy!: PricingStrategy;
  @ApiProperty(DECIMAL) providerInputRate!: string;
  @ApiProperty(DECIMAL) providerOutputRate!: string;
  @ApiProperty(NULLABLE_DECIMAL) cachedInputRate!: string | null;
  @ApiProperty(DECIMAL) additionalFee!: string;
  @ApiProperty(DECIMAL) customerInputRate!: string;
  @ApiProperty(DECIMAL) customerOutputRate!: string;
  @ApiProperty({ ...DECIMAL, example: '50' }) markupPercent!: string;
  @ApiProperty(DECIMAL) simulationInputRate!: string;
  @ApiProperty(DECIMAL) simulationOutputRate!: string;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty(DATE) effectiveAt!: string;
  @ApiProperty({ ...NULLABLE_STRING, description: 'Keycloak subject of the admin, or system-seed.' }) createdBy!: string | null;
  @ApiProperty(DATE) createdAt!: string;
}

export class PricingConfigurationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() modelId!: string;
  @ApiProperty(DATE) createdAt!: string;
  @ApiProperty({ type: () => AIModelView }) model!: AIModelView;
  @ApiProperty({ type: [PricingVersionView], description: 'All versions, newest first.' }) versions!: PricingVersionView[];
}

export class PriceResultView {
  @ApiProperty({ ...DECIMAL, description: 'Actual externally payable cost.' }) actualProviderCost!: string;
  @ApiProperty(DECIMAL) customerCharge!: string;
  @ApiProperty({ ...DECIMAL, example: '0.010000000000', description: 'Scenario only.' }) simulatedProviderCost!: string;
  @ApiProperty({ ...DECIMAL, example: '0.015000000000', description: 'Scenario only; never invoiced.' }) simulatedCustomerCharge!: string;
  @ApiProperty({ ...DECIMAL, description: 'customerCharge − actualProviderCost.' }) grossMargin!: string;
}
