import { erpClient } from './erp-client';

interface ErpSupplierDetail {
  Id?: number;
  Name?: string;
  Contact?: string;
  ContactPhoneNumber?: string;
  MainAccountUsername?: string;
}

export const supplierApi = {
  async getSupplierDetail(supplierId: number): Promise<{
    supplierId: number;
    supplierName: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  }> {
    const detail = await erpClient.get<ErpSupplierDetail>('api/Supplier/Detail', { id: supplierId });
    return {
      supplierId: detail.Id ?? supplierId,
      supplierName: detail.Name ?? `供应商${supplierId}`,
      contactName: detail.Contact ?? '',
      contactPhone: detail.ContactPhoneNumber ?? '',
      contactEmail: detail.MainAccountUsername ?? '',
    };
  },

  async sendNotification(params: {
    supplierId: number;
    type: 'replenishment' | 'urgent' | 'reminder';
    purchaseApplyId?: number;
    message: string;
    expectedReplyDate?: string;
  }): Promise<{ notifyId: string; sentAt: string }> {
    return erpClient.post('api/Supplier/Notify', params);
  },

  async getNotifyStatus(notifyId: string): Promise<{
    notifyId: string;
    status: 'sent' | 'read' | 'confirmed';
    readAt?: string;
    confirmedAt?: string;
  }> {
    return erpClient.get('api/Supplier/NotifyStatus', { notifyId });
  },
};
