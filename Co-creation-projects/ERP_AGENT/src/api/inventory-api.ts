import { erpClient } from './erp-client';
import type { InventoryInfo, PagedResponse } from '../core/types';

interface WarehouseRef {
  Id: number;
  Name?: string;
  Classification?: number | null;
  OperationTeamId?: number | null;
}

interface GoodsRef {
  Name?: string;
}

interface SkuRef {
  Id?: number;
  Name?: string;
  SkuNo?: string;
  ItemNo?: string;
  Goods?: GoodsRef | null;
}

interface StockPageModel {
  WarehouseId: number;
  SkuId: number;
  Stock: number;
  FrozenStock: number;
  AvailableStock: number;
  Status?: number;
  StatusText?: string;
  HighWarnNum?: number | null;
  OrdinaryWarnNum?: number | null;
  SafetyStock?: number | null;
  Warehouse?: WarehouseRef | null;
  Sku?: SkuRef | null;
}

interface StockPageData {
  PageData?: {
    Models?: StockPageModel[];
    TotalCount?: number;
    CurrentPage?: number;
    PageSize?: number;
  };
}

interface AlarmItem {
  WarehouseId?: number;
  WarehouseName?: string;
  Stock?: number;
  AvailableStock?: number;
  FrozenStock?: number;
  Sku?: {
    SkuNo?: string;
  };
}

function normalizeSkuCode(skuCode: string): string {
  return skuCode.replace(/^SKU-?/i, '').trim();
}

function mapStockRow(queryCode: string, row: StockPageModel): InventoryInfo {
  return {
    skuCode: row.Sku?.SkuNo || queryCode,
    skuId: row.Sku?.Id ?? row.SkuId,
    skuName: row.Sku?.Name,
    productName: row.Sku?.Goods?.Name,
    itemNo: row.Sku?.ItemNo,
    warehouseClassification: row.Warehouse?.Classification,
    operationTeamId: row.Warehouse?.OperationTeamId,
    status: row.Status,
    statusText: row.StatusText,
    highWarnNum: row.HighWarnNum,
    ordinaryWarnNum: row.OrdinaryWarnNum,
    safetyStock: row.SafetyStock,
    warehouseId: row.WarehouseId,
    warehouseName: row.Warehouse?.Name ?? '',
    totalQty: row.Stock ?? 0,
    availableQty: row.AvailableStock ?? (row.Stock ?? 0) - (row.FrozenStock ?? 0),
    lockedQty: row.FrozenStock ?? 0,
  };
}

async function queryStockPageList(params: { skuCode?: string; productName?: string }): Promise<StockPageModel[]> {
  const normalizedSku = params.skuCode ? normalizeSkuCode(params.skuCode) : '';
  const productName = params.productName?.trim() ?? '';
  if (!normalizedSku && !productName) return [];

  const data = await erpClient.get<StockPageData>('api/WarehouseStock/StockPageList', {
    Page: 1,
    PageSize: 200,
    WarehouseIds: '',
    ...(normalizedSku ? { SkuNo: normalizedSku } : {}),
    ...(productName ? { GoodsName: productName } : {}),
  });

  return Array.isArray(data?.PageData?.Models) ? data.PageData.Models : [];
}

export const inventoryApi = {
  async getStockBySku(skuCode: string): Promise<InventoryInfo[]> {
    const rows = await queryStockPageList({ skuCode });
    return rows.map((row) => mapStockRow(skuCode, row));
  },

  async getStockByProductName(productName: string): Promise<InventoryInfo[]> {
    const rows = await queryStockPageList({ productName });
    return rows.map((row) => mapStockRow(row.Sku?.SkuNo || productName, row));
  },

  async getStockDetail(skuCode: string, warehouseId: number): Promise<InventoryInfo> {
    const rows = await queryStockPageList({ skuCode });
    const row = rows.find((item) => item.WarehouseId === warehouseId);
    if (!row) {
      return {
        skuCode,
        warehouseId,
        warehouseName: '',
        totalQty: 0,
        availableQty: 0,
        lockedQty: 0,
      };
    }

    return mapStockRow(skuCode, row);
  },

  async getBatchStock(skuCodes: string[]): Promise<InventoryInfo[]> {
    const results = await Promise.all(
      skuCodes.map(async (skuCode) => {
        const rows = await queryStockPageList({ skuCode });
        return rows.map((row) => mapStockRow(skuCode, row));
      }),
    );

    return results.flat();
  },

  async getLowStockList(
    _warehouseId?: number,
    page = 1,
    pageSize = 50,
  ): Promise<PagedResponse<InventoryInfo>> {
    const data = await erpClient.get<{ Items?: AlarmItem[]; Total?: number }>('api/WarehouseStock/AlarmData');
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map((item) => ({
      skuCode: item.Sku?.SkuNo ?? '',
      warehouseId: item.WarehouseId ?? 0,
      warehouseName: item.WarehouseName ?? '',
      totalQty: item.Stock ?? 0,
      availableQty: item.AvailableStock ?? 0,
      lockedQty: item.FrozenStock ?? 0,
    }));

    return {
      items: paged,
      total: data?.Total ?? items.length,
      page,
      pageSize,
    };
  },
};
