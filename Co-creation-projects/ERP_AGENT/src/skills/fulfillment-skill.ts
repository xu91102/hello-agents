import { fulfillmentWorkflow } from '../core/fulfillment-workflow';
import type { FulfillmentLineInput, SkillDef } from '../core/types';

function extractSkuCodes(message: string): string[] {
  const matches = message.match(/SKU-?[A-Za-z0-9_-]+|\b\d{4,}\b/g) ?? [];
  const normalized = matches.map((item) => {
    const value = item.trim();
    return /^SKU-/i.test(value) ? value : `SKU-${value}`;
  });

  return Array.from(new Set(normalized));
}

function extractRequiredQty(message: string): number | null {
  const patterns = [
    /(\d+)\s*(件|个|pcs|PCS)/,
    /数量[：: ]*(\d+)/,
    /requiredQty[：: ]*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const qty = Number(match[1]);
      if (Number.isFinite(qty) && qty > 0) {
        return qty;
      }
    }
  }

  return null;
}

function toItems(rawItems: unknown): FulfillmentLineInput[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const skuCode = Reflect.get(item, 'skuCode');
      const requiredQty = Reflect.get(item, 'requiredQty');
      if (typeof skuCode !== 'string' || typeof requiredQty !== 'number' || requiredQty <= 0) {
        return null;
      }

      return { skuCode, requiredQty };
    })
    .filter((item): item is FulfillmentLineInput => item != null);
}

export const fulfillmentSkill: SkillDef = {
  name: 'fulfillment_flow',
  description: '先叫仓库发货，库存不足时再转采购，并继续协同供应商。',
  triggers: ['发货', '采购', '供应商', '催采购', '仓库'],
  matches(message, context) {
    if (context?.['skillName'] === 'fulfillment_flow') {
      return true;
    }

    if (Array.isArray(context?.['items']) && (context?.['triggerType'] === 'fulfillment' || context?.['skill'] === 'fulfillment_flow')) {
      return true;
    }

    const hasShip = /发货|出库|仓库/.test(message);
    const hasPurchase = /采购|补货|催采购/.test(message);
    const hasSupplier = /供应商|催货|找供应商/.test(message);
    const hasSku = extractSkuCodes(message).length > 0;

    return hasSku && hasShip && (hasPurchase || hasSupplier);
  },
  buildInput(message, context) {
    const contextItems = toItems(context?.['items']);
    if (contextItems.length > 0) {
      return {
        items: contextItems,
        autoNotifySupplier: context?.['autoNotifySupplier'] ?? true,
      };
    }

    const skuCodes = extractSkuCodes(message);
    if (skuCodes.length === 0) {
      return null;
    }

    const qty = extractRequiredQty(message) ?? 1;
    return {
      items: skuCodes.map((skuCode) => ({ skuCode, requiredQty: qty })),
      autoNotifySupplier: context?.['autoNotifySupplier'] ?? true,
    };
  },
  async execute(input) {
    const items = toItems(input['items']);
    if (items.length === 0) {
      throw new Error('fulfillment_flow skill 缺少有效 items');
    }

    const result = await fulfillmentWorkflow.execute({
      items,
      autoNotifySupplier: (input['autoNotifySupplier'] as boolean) ?? true,
    });

    return {
      result: result.summary,
      metadata: { lines: result.lines, skillName: 'fulfillment_flow' },
    };
  },
};
