const avro = require('avsc');

const orderSchema = avro.Type.forSchema({
  type: 'record',
  name: 'Order',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'customerName', type: 'string' },
    { name: 'deliveryAddress', type: 'string' },
    { name: 'restaurantId', type: 'string' }
  ]
});

const dlqSchema = avro.Type.forSchema({
  type: 'record',
  name: 'DLQMessage',
  fields: [
    { name: 'originalMessage', type: 'string' },
    { name: 'error', type: 'string' },
    { name: 'timestamp', type: 'string' },
    { name: 'retryAttempts', type: 'int' }
  ]
});

module.exports = { orderSchema, dlqSchema };
