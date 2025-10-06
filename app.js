const { Kafka } = require("kafkajs");

// Kafka client setup
const kafka = new Kafka({
  clientId: "food-delivery-app",
  brokers: ["localhost:9092"],
});
const orderTopic = "order-events";
const retryTopic = "order-retry";
const dlqTopic = "order-events-dlq";

const producer = kafka.producer();

async function handleFailure(message, error, producer) {
  const retryCount = parseInt(message.headers?.["retry-count"] || "0");
  const maxRetries = 3;
  if (retryCount < maxRetries) {
    const delaySeconds = Math.pow(2, retryCount);
    const retryTimestamp = Date.now() + delaySeconds * 1000;

    console.log(
      `Retry attempt ${retryCount + 1}/${maxRetries} in ${delaySeconds}s: ${
        error.message
      }`
    );
    await producer.send({
      topic: retryTopic,
      messages: [
        {
          value: message.value,
          headers: {
            "retry-count": (retryCount + 1).toString(),
            "retry-timestamp": retryTimestamp.toString(),
            error: error.message,
            "original-topic": orderTopic,
          },
        },
      ],
    });
  } else {
    console.log(`Sending to DLQ: ${error.message}`);
    await producer.send({
      topic: dlqTopic,
      messages: [
        {
          value: JSON.stringify({
            originalMessage: message.value.toString(),
            error: error.message,
            timestamp: new Date().toISOString(),
            retryAttempts: retryCount,
          }),
          headers: { "original-topic": orderTopic },
        },
      ],
    });
  }
}

async function processOrders() {
  const consumer = kafka.consumer({ groupId: "order-processing-group" });
  await consumer.connect();
  await consumer.subscribe({ topic: orderTopic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log("\nPartition: ", partition);
      try {
        const order = JSON.parse(message.value.toString());
        if (!order.deliveryAddress || order.deliveryAddress === "") {
          throw new Error("Invalid delivery address");
        }
        if (order.restaurantId === "offline-restaurant") {
          throw new Error("Restaurant API is offline");
        }
        console.log(
          `Processing order ${order.orderId} for ${order.customerName}`
        );
      } catch (error) {
        await handleFailure(message, error, producer);
      }
    },
  });
}
async function processRetries() {
  const retryConsumer = kafka.consumer({ groupId: "retry-processing-group" });
  await retryConsumer.connect();
  await retryConsumer.subscribe({ topic: retryTopic, fromBeginning: true });

  await retryConsumer.run({
    eachMessage: async ({ message }) => {
      const retryTimestamp = parseInt(
        message.headers?.["retry-timestamp"] || "0"
      );
      const now = Date.now();
      if (retryTimestamp > now) {
        const waitTime = retryTimestamp - now;
        console.log(
          `Waiting ${Math.ceil(waitTime / 1000)}s before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      console.log(`Retrying message now...`);
      await producer.send({
        topic: orderTopic,
        messages: [{ value: message.value, headers: message.headers }],
      });
    },
  });
}
async function monitorDLQ() {
  const dlqConsumer = kafka.consumer({ groupId: "dlq-monitor-group" });
  await dlqConsumer.connect();
  await dlqConsumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  await dlqConsumer.run({
    eachMessage: async ({ message }) => {
      const deadMessage = JSON.parse(message.value.toString());
      console.log(`\n💀 DLQ Message Received:`);
      console.log(JSON.stringify(deadMessage, null, 2));
    },
  });
}
async function start() {
  try {
    await producer.connect();
    // console.log("Initializing topics...");
    // await producer.send({
    //   topic: orderTopic,
    //   messages: [{ value: JSON.stringify({ init: true }) }],
    // });
    // await producer.send({
    //   topic: retryTopic,
    //   messages: [{ value: JSON.stringify({ init: true }) }],
    // });
    // await producer.send({
    //   topic: dlqTopic,
    //   messages: [{ value: JSON.stringify({ init: true }) }],
    // });
    await Promise.all([processOrders(), processRetries(), monitorDLQ()]);
    setTimeout(async () => {
      console.log("Sending test orders...\n");
      await producer.send({
        topic: orderTopic,
        messages: [
          {
            value: JSON.stringify({
              orderId: "001",
              customerName: "John",
              deliveryAddress: "123 Main St",
              restaurantId: "r1",
            }),
          }, // Will succeed
          {
            value: JSON.stringify({
              orderId: "002",
              customerName: "Jane",
              deliveryAddress: "",
              restaurantId: "r2",
            }),
          }, // Failure - Invalid Deilvery address
          {
            value: JSON.stringify({
              orderId: "003",
              customerName: "Bob",
              deliveryAddress: "456 Oak Ave",
              restaurantId: "offline-restaurant",
            }),
          }, // Failure - Restaurant API is offline
        ],
      });
    }, 1500);
  } catch (error) {
    console.log("Error in Kafka operation:", error.message);
  }
}

start();
