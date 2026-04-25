import { erpClient } from './erp-client';
import type { LogisticsChannel, OutOrder } from '../core/types';

/**
 * 物流协调 API（对接 AceFx.WebApi 物流渠道和出库单接口）
 */
export const logisticsApi = {
  /**
   * 查询可用物流渠道
   * 对接: GET /api/logistics-channel/list
   */
  async getChannels(params?: {
    destinationCountry?: string;
    warehouseId?: number;
  }): Promise<LogisticsChannel[]> {
    return erpClient.get<LogisticsChannel[]>('api/LogisticsChannel/List', params);
  },

  /**
   * 创建出库单
   * 对接: POST api/OutOrder/Add
   */
  async createOutOrder(params: {
    orderId: number;
    channelId: number;
    skuList: Array<{ skuCode: string; qty: number }>;
    warehouseId: number;
  }): Promise<OutOrder> {
    return erpClient.post<OutOrder>('api/OutOrder/Add', params);
  },

  /**
   * 推送出库单到外部 WMS（若后端无此接口则可能 404）
   */
  async pushToWms(outOrderId: number): Promise<{ success: boolean; trackingNo?: string }> {
    try {
      return await erpClient.post('api/ExternalWms/Push', { outOrderId });
    } catch {
      return { success: false };
    }
  },

  /**
   * 查询出库单状态
   * 对接: GET api/OutOrder/Detail?id=
   */
  async getOutOrderDetail(outOrderId: number): Promise<OutOrder> {
    return erpClient.get<OutOrder>('api/OutOrder/Detail', { id: outOrderId });
  },
};
