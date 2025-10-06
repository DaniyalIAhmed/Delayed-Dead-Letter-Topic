const { Kafka } = require("kafkajs");
const logger = require("./logger");
const { orderSchema, dlqSchema } = require("./schemas");

const kafka = new Kafka({
  clientId: "food-delivery-app",
  brokers: ["localhost:9092"],
});

const TOPICS = {
  ORDER: "order-events",
  RETRY: "order-retry",
  DLQ: "order-events-dlq",
};

const CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 2,
};

const producer = kafka.producer();

const getRetryCount = (headers) => parseInt(headers?.["retry-count"] || "0");

const calculateBackoff = (retryCount) => ({
  delaySeconds: Math.pow(CONFIG.BASE_DELAY, retryCount),
  timestamp: Date.now() + Math.pow(CONFIG.BASE_DELAY, retryCount) * 1000,
});

const sendToRetry = async (message, error, retryCount) => {
  const { delaySeconds, timestamp } = calculateBackoff(retryCount);
  logger.warn(`Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} in ${delaySeconds}s: ${error.message}`);
  
  await producer.send({
    topic: TOPICS.RETRY,
    messages: [{
      value: message.value,
      headers: {
        "retry-count": (retryCount + 1).toString(),
        "retry-timestamp": timestamp.toString(),
        error: error.message,
        "original-topic": TOPICS.ORDER,
      },
    }],
  });
};

const sendToDLQ = async (message, error, retryCount) => {
  logger.error(`Max retries reached. DLQ: ${error.message}`);
  
  const dlqMessage = dlqSchema.toBuffer({
    originalMessage: message.value.toString(),
    error: error.message,
    timestamp: new Date().toISOString(),
    retryAttempts: retryCount,
  });

  await producer.send({
    topic: TOPICS.DLQ,
    messages: [{ value: dlqMessage, headers: { "original-topic": TOPICS.ORDER } }],
  });
};

const handleFailure = async (message, error) => {
  const retryCount = getRetryCount(message.headers);
  retryCount < CONFIG.MAX_RETRIES
    ? await sendToRetry(message, error, retryCount)
    : await sendToDLQ(message, error, retryCount);
};

const validateOrder = (order) => {
  if (!order.deliveryAddress) throw new Error("Invalid delivery address");
  if (order.restaurantId === "offline-restaurant") throw new Error("Restaurant API offline");
};

const processOrder = async (message) => {
  const order = orderSchema.fromBuffer(message.value);
  validateOrder(order);
  logger.info(`Order processed: ${order.orderId} - ${order.customerName}`);
};

const waitForRetry = async (retryTimestamp) => {
  const waitTime = retryTimestamp - Date.now();
  if (waitTime > 0) {
    logger.info(`Waiting ${Math.ceil(waitTime / 1000)}s before retry`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
};

const createConsumer = async (groupId, topic, handler) => {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({ eachMessage: handler });
};

const processOrders = () => createConsumer("order-processing-group", TOPICS.ORDER, 
  async ({ partition, message }) => {
    logger.info(`Partition: ${partition}`);
    try {
      await processOrder(message);
    } catch (error) {
      await handleFailure(message, error);
    }
  }
);

const processRetries = () => createConsumer("retry-processing-group", TOPICS.RETRY,
  async ({ message }) => {
    const retryTimestamp = parseInt(message.headers?.["retry-timestamp"] || "0");
    await waitForRetry(retryTimestamp);
    logger.info("Retrying message");
    await producer.send({
      topic: TOPICS.ORDER,
      messages: [{ value: message.value, headers: message.headers }],
    });
  }
);

const monitorDLQ = () => createConsumer("dlq-monitor-group", TOPICS.DLQ,
  async ({ message }) => {
    const deadMessage = dlqSchema.fromBuffer(message.value);
    logger.error(`DLQ Message: ${JSON.stringify(deadMessage, null, 2)}`);
  }
);

const sendTestOrders = async () => {
  const orders = [
    { orderId: "001", customerName: "John", deliveryAddress: "123 Main St", restaurantId: "r1" },
    { orderId: "002", customerName: "Jane", deliveryAddress: "", restaurantId: "r2" },
    { orderId: "003", customerName: "Bob", deliveryAddress: "456 Oak Ave", restaurantId: "offline-restaurant" },
  ];

  logger.info("Sending test orders");
  await producer.send({
    topic: TOPICS.ORDER,
    messages: orders.map(order => ({ value: orderSchema.toBuffer(order) })),
  });
};

const start = async () => {
  try {
    await producer.connect();
    await Promise.all([processOrders(), processRetries(), monitorDLQ()]);
    setTimeout(sendTestOrders, 1500);
  } catch (error) {
    logger.error(`Kafka operation failed: ${error.message}`);
  }
};

start();
