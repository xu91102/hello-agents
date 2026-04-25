# QQPGERP Agent API Examples

默认地址：`http://localhost:3101`

## Health

```http
GET /health
```

## Chat

```http
POST /api/agent/chat
Content-Type: application/json

{
  "message": "查询 SKU-09871 的库存"
}
```

## Customer Service Chat

这条接口走 AI 客服 RAG 知识库，适合服务费、企微回访、采购款充值、收益提现、跨境店、协议条款、APP 或小程序操作等标准话术问题。

```http
POST /api/agent/customer-service/chat
Content-Type: application/json

{
  "message": "开店服务费可以退款吗？",
  "sessionId": "customer-service-demo-001"
}
```

示例响应：

```json
{
  "taskId": "8e88d2a4-8f59-4d53-a36e-2c3976780f53",
  "status": "completed",
  "result": "在您完成通讯服务费及开店服务费的支付后，您将拥有三天的考虑期...",
  "steps": [
    {
      "stepIndex": 0,
      "toolName": "skill:customer_service_faq"
    }
  ],
  "metadata": {
    "intent": "customer_service_faq",
    "matchedCategory": "一、关于服务费类别的事宜",
    "needsHuman": false
  }
}
```

## Stock Alert

```http
POST /api/agent/stock-alert
Content-Type: application/json

{
  "skuCode": "SKU-09871",
  "currentQty": 10,
  "safetyQty": 50
}
```

## Fulfillment Flow

这条接口走固定流程：
`仓库发货 -> 库存不足转采购 -> 采购协同供应商`

```http
POST /api/agent/fulfillment
Content-Type: application/json

{
  "items": [
    { "skuCode": "SKU-09871", "requiredQty": 200 }
  ],
  "autoNotifySupplier": true
}
```

示例响应：

```json
{
  "taskId": "8e88d2a4-8f59-4d53-a36e-2c3976780f53",
  "status": "completed",
  "result": "SKU-09871: 仓库发货 白云仓 156；缺口 44；已定位供应商 演示供应商，待采购人工跟进；供应商需人工催办",
  "steps": [
    {
      "stepIndex": 0,
      "toolName": "execute_fulfillment_flow",
      "toolArgs": {
        "items": [
          { "skuCode": "SKU-09871", "requiredQty": 200 }
        ],
        "autoNotifySupplier": true
      }
    }
  ],
  "metadata": {
    "lines": [
      {
        "skuCode": "SKU-09871",
        "requiredQty": 200,
        "availableQty": 156,
        "shippedQty": 156,
        "shortageQty": 44,
        "status": "partial_purchase_required"
      }
    ]
  }
}
```

## cURL

```bash
curl -X POST "http://localhost:3101/api/agent/fulfillment" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"skuCode\":\"SKU-09871\",\"requiredQty\":200}],\"autoNotifySupplier\":true}"
```
