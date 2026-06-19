import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DeliveryUnitFieldType } from '../../../../generated/delivery-client';
import { UpdateUnitFieldConfigItemDto } from './update-unit-field-config.dto';

describe('UpdateUnitFieldConfigItemDto', () => {
  it('rejects non-numeric or out-of-range sortOrder values', () => {
    const nonNumeric = plainToInstance(UpdateUnitFieldConfigItemDto, {
      fieldKey: 'gateCode',
      sortOrder: 'abc',
    });
    const tooLarge = plainToInstance(UpdateUnitFieldConfigItemDto, {
      fieldKey: 'gateCode',
      sortOrder: 1000,
    });

    expect(validateSync(nonNumeric).length).toBeGreaterThan(0);
    expect(validateSync(tooLarge).length).toBeGreaterThan(0);
  });

  it('rejects malformed options for select fields and options on non-select fields', () => {
    const malformedSelect = plainToInstance(UpdateUnitFieldConfigItemDto, {
      fieldKey: 'gateCode',
      fieldType: DeliveryUnitFieldType.SELECT,
      options: [{ value: 'A' }],
    });
    const nonSelectWithOptions = plainToInstance(UpdateUnitFieldConfigItemDto, {
      fieldKey: 'roomNo',
      fieldType: DeliveryUnitFieldType.TEXT,
      options: ['A', 'B'],
    });

    expect(validateSync(malformedSelect).length).toBeGreaterThan(0);
    expect(validateSync(nonSelectWithOptions).length).toBeGreaterThan(0);
  });

  it('accepts bounded sortOrder and normalized select options', () => {
    const dto = plainToInstance(UpdateUnitFieldConfigItemDto, {
      fieldKey: 'gateCode',
      fieldType: DeliveryUnitFieldType.SELECT,
      sortOrder: '12',
      options: [
        { label: 'A 区', value: 'A' },
        { label: 'B 区', value: 'B' },
      ],
    });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.sortOrder).toBe(12);
  });
});
