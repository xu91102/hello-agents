import { erpClient } from './erp-client';
import type { PurchaseApply, SupplierCandidate } from '../core/types';

interface ErpSupplierRef {
  Id?: number | string;
  Name?: string;
}

interface ErpPurchaseSupplier {
  Id?: number | null;
  SkuId?: number;
  SupplierId?: number | string | null;
  Name?: string;
  Supplier?: ErpSupplierRef | null;
  StandardPurchasePrice?: number | null;
  MinPurchasePrice?: number | null;
  DeliveryDate?: number | string | null;
  IsDefault?: number | null;
  PurchaseLink?: string;
  TaxRate?: number | null;
  IsTax?: number | null;
  BillingDataType?: string;
  BillingEntity?: string;
}

interface ErpWarehouse {
  Id?: number;
  Name?: string;
  Classification?: number | null;
  IsDefault?: boolean;
  OperationTeamId?: number | null;
}

interface ErpGoodsSku {
  Id?: number;
  GoodsId?: number;
  Name?: string;
  SpecName?: string;
  SkuNo?: string;
  ItemNo?: string;
  PurchaseSuppliers?: ErpPurchaseSupplier[];
}

interface ErpGoodsPurchaseDetails {
  GoodsSkuPurchaseSupplierList?: ErpPurchaseSupplier[];
}

interface ErpPurchaseApplySku {
  Id?: number;
  PurchaseApplyId?: number;
  GoodsId?: number;
  GoodsName?: string;
  SkuId?: number;
  SkuSpecName?: string;
  OperationTeamId?: number | null;
  OperationTeamName?: string | null;
  WarehouseId?: number | null;
  WarehouseName?: string | null;
  OverseasWarehouseId?: number | null;
  OverseasWarehouseName?: string | null;
  VirtualWarehouseId?: number | null;
  VirtualWarehouseName?: string | null;
  SupplierId?: number | null;
  SupplierName?: string | null;
  PurchaseUrl?: string | null;
  ApplyQuantity?: number;
  ApprovalQuantity?: number;
  PriceWithTax?: number | null;
  PriceWithoutTax?: number | null;
  TaxRate?: number | null;
  SubtotalWithTax?: number | null;
  SubtotalWithoutTax?: number | null;
  IsTax?: number | null;
  PurchasePrice?: number | null;
  IsBillingData?: number | null;
  BillingDataType?: string | null;
  BillingEntity?: string | null;
  ItemNo?: string | null;
  SkuNo?: string | null;
}

interface ErpPurchaseApplyDetail {
  Id?: number;
  Number?: string;
  ExpectArrivalDate?: string;
  Status?: number | string;
  Remark?: string;
  ApplicantId?: number;
  Applicant?: string;
  PurchaseApplySkuList?: ErpPurchaseApplySku[];
}

interface PurchaseApplyInput {
  skuCode: string;
  qty: number;
  supplier: SupplierCandidate;
  estimatedArrivalDate: string;
  isUrgent?: boolean;
  remark?: string;
  warehouseId?: number;
  warehouseName?: string;
  overseasWarehouseId?: number;
  overseasWarehouseName?: string;
  virtualWarehouseId?: number;
  virtualWarehouseName?: string;
  operationTeamId?: number;
}

interface PurchaseWarehouseContext {
  warehouseId?: number;
  warehouseName?: string;
  overseasWarehouseId?: number;
  overseasWarehouseName?: string;
  virtualWarehouseId?: number;
  virtualWarehouseName?: string;
  operationTeamId?: number;
}

interface SkuProcurementContext {
  goodsId: number;
  skuId: number;
  skuCode: string;
  goodsName: string;
  skuSpecName: string;
  itemNo: string;
  suppliers: SupplierCandidate[];
}

function normalizeSkuCode(skuCode: string): string {
  return skuCode.replace(/^SKU-?/i, '').trim();
}

function toNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toInt(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toOptionalNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function mapSupplier(row: ErpPurchaseSupplier, sku: ErpGoodsSku): SupplierCandidate | null {
  const supplierId = toInt(row.SupplierId ?? row.Supplier?.Id);
  if (supplierId == null) {
    return null;
  }

  const supplierName = row.Name ?? row.Supplier?.Name ?? `供应商${supplierId}`;
  const unitPrice = Number(row.StandardPurchasePrice ?? row.MinPurchasePrice ?? 0) || 0;
  const leadDays = Math.max(1, toInt(row.DeliveryDate ?? 7) ?? 7);

  return {
    supplierId,
    supplierName,
    unitPrice,
    leadDays,
    rating: row.IsDefault === 1 ? 100 : 80,
    purchaseUrl: row.PurchaseLink,
    isDefault: row.IsDefault === 1,
    goodsId: sku.GoodsId,
    skuId: sku.Id,
    goodsName: sku.Name,
    skuSpecName: sku.SpecName,
    billingDataType: row.BillingDataType,
    billingEntity: row.BillingEntity,
    taxRate: row.TaxRate == null ? undefined : toNumber(row.TaxRate),
    isTax: row.IsTax == null ? undefined : toNumber(row.IsTax),
  };
}

async function queryWarehouses(params: Record<string, unknown>): Promise<ErpWarehouse[]> {
  return erpClient.get<ErpWarehouse[]>('api/Warehouse/List', {
    Statuses: '1',
    ...params,
  });
}

function chooseWarehouse(warehouses: ErpWarehouse[]): ErpWarehouse | undefined {
  return warehouses.find((warehouse) => warehouse.IsDefault) ?? warehouses[0];
}

async function getWarehouseById(id: number | undefined): Promise<ErpWarehouse | undefined> {
  if (!id) {
    return undefined;
  }

  const warehouses = await queryWarehouses({ Ids: String(id) });
  return warehouses[0];
}

async function getDefaultWarehouse(
  classification: number,
  operationTeamId?: number,
): Promise<ErpWarehouse | undefined> {
  const teamWarehouses = operationTeamId
    ? await queryWarehouses({
        Classifications: String(classification),
        OperationTeamIds: String(operationTeamId),
      })
    : [];

  if (teamWarehouses.length > 0) {
    return chooseWarehouse(teamWarehouses);
  }

  const warehouses = await queryWarehouses({ Classifications: String(classification) });
  return chooseWarehouse(warehouses);
}

async function resolvePurchaseWarehouses(
  params: PurchaseApplyInput,
): Promise<PurchaseWarehouseContext> {
  const [explicitWarehouse, explicitOverseasWarehouse, explicitVirtualWarehouse] = await Promise.all([
    getWarehouseById(params.warehouseId),
    getWarehouseById(params.overseasWarehouseId),
    getWarehouseById(params.virtualWarehouseId),
  ]);

  const context: PurchaseWarehouseContext = {
    operationTeamId: toOptionalNumber(
      params.operationTeamId ??
      explicitWarehouse?.OperationTeamId ??
      explicitOverseasWarehouse?.OperationTeamId ??
        explicitVirtualWarehouse?.OperationTeamId,
    ),
  };

  const assignWarehouse = (warehouse: ErpWarehouse | undefined, fallbackName?: string) => {
    if (!warehouse?.Id) {
      return;
    }

    const name = warehouse.Name ?? fallbackName ?? '';
    if (warehouse.Classification === 1) {
      context.warehouseId = context.warehouseId ?? warehouse.Id;
      context.warehouseName = context.warehouseName ?? name;
      return;
    }

    if (warehouse.Classification === 2) {
      context.overseasWarehouseId = context.overseasWarehouseId ?? warehouse.Id;
      context.overseasWarehouseName = context.overseasWarehouseName ?? name;
      return;
    }

    if (warehouse.Classification === 3) {
      context.virtualWarehouseId = context.virtualWarehouseId ?? warehouse.Id;
      context.virtualWarehouseName = context.virtualWarehouseName ?? name;
    }
  };

  assignWarehouse(explicitWarehouse, params.warehouseName);
  assignWarehouse(explicitOverseasWarehouse, params.overseasWarehouseName);
  assignWarehouse(explicitVirtualWarehouse, params.virtualWarehouseName);

  if (params.warehouseId && !explicitWarehouse) {
    context.warehouseId = context.warehouseId ?? params.warehouseId;
    context.warehouseName = context.warehouseName ?? params.warehouseName ?? '';
  }
  if (params.overseasWarehouseId && !explicitOverseasWarehouse) {
    context.overseasWarehouseId = context.overseasWarehouseId ?? params.overseasWarehouseId;
    context.overseasWarehouseName =
      context.overseasWarehouseName ?? params.overseasWarehouseName ?? '';
  }
  if (params.virtualWarehouseId && !explicitVirtualWarehouse) {
    context.virtualWarehouseId = context.virtualWarehouseId ?? params.virtualWarehouseId;
    context.virtualWarehouseName = context.virtualWarehouseName ?? params.virtualWarehouseName ?? '';
  }

  const [defaultWarehouse, defaultOverseasWarehouse, defaultVirtualWarehouse] = await Promise.all([
    context.warehouseId ? undefined : getDefaultWarehouse(1, context.operationTeamId),
    context.overseasWarehouseId ? undefined : getDefaultWarehouse(2, context.operationTeamId),
    context.virtualWarehouseId ? undefined : getDefaultWarehouse(3, context.operationTeamId),
  ]);

  assignWarehouse(defaultWarehouse);
  assignWarehouse(defaultOverseasWarehouse);
  assignWarehouse(defaultVirtualWarehouse);

  context.operationTeamId = toOptionalNumber(
    context.operationTeamId ??
    defaultWarehouse?.OperationTeamId ??
    defaultOverseasWarehouse?.OperationTeamId ??
      defaultVirtualWarehouse?.OperationTeamId,
  );

  return context;
}

async function queryGoodsSku(params: Record<string, unknown>): Promise<ErpGoodsSku[]> {
  return erpClient.get<ErpGoodsSku[]>('api/GoodsSku/List', {
    IncludeAssociatedInfo: true,
    IncludeStock: false,
    ...params,
  });
}

async function findSkuContext(skuCode: string): Promise<SkuProcurementContext | null> {
  const normalizedSku = normalizeSkuCode(skuCode);
  if (!normalizedSku) {
    return null;
  }

  const searchResults = await queryGoodsSku({ SkuNo: normalizedSku });
  const fallbackResults = searchResults.length > 0 ? [] : await queryGoodsSku({ ItemNo: normalizedSku });
  const skuList = searchResults.length > 0 ? searchResults : fallbackResults;
  if (skuList.length === 0) {
    return null;
  }

  const matchedSku =
    skuList.find((item) => item.SkuNo === normalizedSku) ??
    skuList.find((item) => item.ItemNo === normalizedSku) ??
    skuList[0];
  if (!matchedSku?.Id || !matchedSku.GoodsId) {
    return null;
  }

  let suppliers = (matchedSku.PurchaseSuppliers ?? [])
    .map((item) => mapSupplier(item, matchedSku))
    .filter((item): item is SupplierCandidate => item != null);

  if (suppliers.length === 0) {
    const detail = await erpClient.get<ErpGoodsPurchaseDetails>(
      'api/GoodsSkuPurchaseSupplier/GetByGoodsId',
      { id: matchedSku.GoodsId },
    );
    suppliers = (detail.GoodsSkuPurchaseSupplierList ?? [])
      .filter((item) => item.SkuId === matchedSku.Id)
      .map((item) => mapSupplier(item, matchedSku))
      .filter((item): item is SupplierCandidate => item != null);
  }

  return {
    goodsId: matchedSku.GoodsId,
    skuId: matchedSku.Id,
    skuCode,
    goodsName: matchedSku.Name ?? matchedSku.ItemNo ?? normalizedSku,
    skuSpecName: matchedSku.SpecName ?? '',
    itemNo: matchedSku.ItemNo ?? normalizedSku,
    suppliers,
  };
}

export const purchaseApi = {
  async getSuppliersBySku(skuCode: string): Promise<SupplierCandidate[]> {
    const context = await findSkuContext(skuCode);
    return context?.suppliers ?? [];
  },

  async createPurchaseApply(params: PurchaseApplyInput): Promise<PurchaseApply> {
    const context = await findSkuContext(params.skuCode);
    if (!context) {
      throw new Error(`SKU ${params.skuCode} 未找到可采购的商品资料`);
    }

    const warehouseContext = await resolvePurchaseWarehouses(params);
    const remarkParts = [
      params.remark,
      `Agent推荐供应商:${params.supplier.supplierName}(${params.supplier.supplierId})`,
      params.isUrgent ? '紧急补货' : '',
    ].filter(Boolean);

    const priceWithTax = params.supplier.unitPrice || undefined;
    const priceWithoutTax = params.supplier.unitPrice || undefined;
    const subtotalWithTax = priceWithTax ? Number((priceWithTax * params.qty).toFixed(4)) : undefined;
    const subtotalWithoutTax = priceWithoutTax ? Number((priceWithoutTax * params.qty).toFixed(4)) : undefined;

    const payload = {
      ExpectArrivalDate: params.estimatedArrivalDate,
      Remark: remarkParts.join('，'),
      PurchaseApplySkuInputs: [
        {
          GoodsId: context.goodsId,
          GoodsName: context.goodsName,
          SkuId: context.skuId,
          SkuSpecName: context.skuSpecName,
          OperationTeamId: warehouseContext.operationTeamId,
          VirtualWarehouseId: warehouseContext.virtualWarehouseId,
          VirtualWarehouseName: warehouseContext.virtualWarehouseName ?? '',
          WarehouseId: warehouseContext.warehouseId,
          WarehouseName: warehouseContext.warehouseName ?? '',
          OverseasWarehouseId: warehouseContext.overseasWarehouseId,
          OverseasWarehouseName: warehouseContext.overseasWarehouseName ?? '',
          SupplierId: params.supplier.supplierId,
          SupplierName: params.supplier.supplierName,
          ApplyQuantity: params.qty,
          PurchaseUrl: params.supplier.purchaseUrl ?? '',
          Remark: `推荐供应商：${params.supplier.supplierName}`,
          PriceWithTax: priceWithTax,
          PriceWithoutTax: priceWithoutTax,
          TaxRate: params.supplier.taxRate,
          SubtotalWithTax: subtotalWithTax,
          SubtotalWithoutTax: subtotalWithoutTax,
          IsTax: params.supplier.isTax,
          IsBillingData: params.supplier.billingDataType || params.supplier.billingEntity ? 1 : undefined,
          BillingDataType: params.supplier.billingDataType,
          BillingEntity: params.supplier.billingEntity,
          PurchasePrice: params.supplier.unitPrice || undefined,
        },
      ],
    };

    const detail = await erpClient.post<ErpPurchaseApplyDetail>(
      'api/PurchaseApply/AddAndGetDetail',
      payload,
    );
    const applySku = detail.PurchaseApplySkuList?.[0];
    const approvalQty = applySku?.ApprovalQuantity && applySku.ApprovalQuantity > 0
      ? applySku.ApprovalQuantity
      : applySku?.ApplyQuantity ?? params.qty;

    return {
      applyId: detail.Id,
      applyNumber: detail.Number,
      applySkuId: applySku?.Id,
      skuCode: params.skuCode,
      qty: approvalQty,
      supplierId: toFiniteNumber(applySku?.SupplierId) ?? params.supplier.supplierId,
      supplierName: applySku?.SupplierName ?? params.supplier.supplierName,
      estimatedArrivalDate: String(detail.ExpectArrivalDate ?? params.estimatedArrivalDate),
      status: detail.Status != null ? String(detail.Status) : 'created',
      applyCreated: Boolean(detail.Id),
      remark: payload.Remark,
      goodsId: applySku?.GoodsId ?? context.goodsId,
      goodsName: applySku?.GoodsName ?? context.goodsName,
      skuId: applySku?.SkuId ?? context.skuId,
      skuSpecName: applySku?.SkuSpecName ?? context.skuSpecName,
      itemNo: applySku?.ItemNo ?? applySku?.SkuNo ?? context.itemNo,
      warehouseId: toFiniteNumber(applySku?.WarehouseId ?? warehouseContext.warehouseId),
      warehouseName: applySku?.WarehouseName ?? warehouseContext.warehouseName,
      overseasWarehouseId: toFiniteNumber(applySku?.OverseasWarehouseId ?? warehouseContext.overseasWarehouseId),
      overseasWarehouseName: applySku?.OverseasWarehouseName ?? warehouseContext.overseasWarehouseName,
      virtualWarehouseId: toFiniteNumber(applySku?.VirtualWarehouseId ?? warehouseContext.virtualWarehouseId),
      virtualWarehouseName: applySku?.VirtualWarehouseName ?? warehouseContext.virtualWarehouseName,
      operationTeamId: toFiniteNumber(applySku?.OperationTeamId ?? warehouseContext.operationTeamId),
      operationTeamName: applySku?.OperationTeamName ?? undefined,
      purchaseUrl: applySku?.PurchaseUrl ?? params.supplier.purchaseUrl,
      applyQuantity: applySku?.ApplyQuantity ?? params.qty,
      approvalQuantity: approvalQty,
      priceWithTax: toFiniteNumber(applySku?.PriceWithTax ?? priceWithTax),
      priceWithoutTax: toFiniteNumber(applySku?.PriceWithoutTax ?? priceWithoutTax),
      taxRate: toFiniteNumber(applySku?.TaxRate ?? params.supplier.taxRate),
      subtotalWithTax: toFiniteNumber(applySku?.SubtotalWithTax ?? subtotalWithTax),
      subtotalWithoutTax: toFiniteNumber(applySku?.SubtotalWithoutTax ?? subtotalWithoutTax),
      isTax: toFiniteNumber(applySku?.IsTax ?? params.supplier.isTax),
      purchasePrice: toFiniteNumber(applySku?.PurchasePrice ?? params.supplier.unitPrice),
      isBillingData: toFiniteNumber(applySku?.IsBillingData),
      billingDataType: applySku?.BillingDataType ?? params.supplier.billingDataType,
      billingEntity: applySku?.BillingEntity ?? params.supplier.billingEntity,
    };
  },

  async getApplyDetail(applyId: number): Promise<PurchaseApply> {
    const detail = await erpClient.get<Record<string, unknown>>('api/PurchaseApply/Detail', { id: applyId });
    return {
      applyId,
      skuCode: String(detail['ItemNo'] ?? ''),
      qty: Number(detail['ApplyQuantity'] ?? 0),
      supplierId: Number(detail['SupplierId'] ?? 0),
      supplierName: String(detail['SupplierName'] ?? ''),
      estimatedArrivalDate: String(detail['ExpectArrivalDate'] ?? ''),
      status: String(detail['Status'] ?? ''),
    };
  },

  async getApplyDetailRaw(applyId: number): Promise<Record<string, unknown>> {
    return erpClient.get<Record<string, unknown>>('api/PurchaseApply/GetDetail', {
      id: applyId,
      includeLogs: false,
    });
  },

  async firstAuditApply(input: Record<string, unknown>): Promise<void> {
    await erpClient.post<void>('api/PurchaseApply/FirstAuditApply', input);
  },

  async secondAuditApply(input: Record<string, unknown>): Promise<void> {
    await erpClient.post<void>('api/PurchaseApply/SecondAuditApply', input);
  },

  async genPurchaseOrderFromApply(input: Record<string, unknown>): Promise<void> {
    await erpClient.post<void>('api/PurchaseApply/GenPurchaseOrderFromApply', input);
  },

  async rejectApply(input: Record<string, unknown>): Promise<void> {
    await erpClient.post<void>('api/PurchaseApply/Reject', input);
  },
};
