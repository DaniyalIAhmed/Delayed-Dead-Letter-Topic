# Kafka Retry Pattern with Dead Letter Queue (DLQ)

A production-ready implementation of **exponential backoff retry logic** and **Dead Letter Queue (DLQ)** pattern using **Apache Kafka** and **KafkaJS**.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Exponential Backoff Strategy](#exponential-backoff-strategy)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Topics](#topics)
- [Message Flow](#message-flow)
- [Error Handling](#error-handling)
- [Production Considerations](#production-considerations)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

This project demonstrates a resilient message processing system for a food delivery application using Kafka. It implements automatic retry mechanisms with exponential backoff and routes permanently failed messages to a Dead Letter Queue for manual intervention.

### Use Case: Food Delivery Order Processing

The system validates and processes food delivery orders with the following checks:
- ✅ Delivery address validation
- ✅ Restaurant availability verification
- ✅ Order data integrity

Failed orders are automatically retried with increasing delays before being sent to the DLQ.

## ✨ Features

- **Exponential Backoff**: Retry delays increase exponentially (1s → 2s → 4s)
- **Dead Letter Queue**: Captures messages that fail after maximum retries
- **Configurable Retries**: Default 3 attempts (easily adjustable)
- **Message Tracking**: Each message tracks retry count and timestamps
- **Error Logging**: Comprehensive error messages with context
- **DLQ Monitoring**: Separate consumer for monitoring failed messages
- **Graceful Degradation**: System continues processing valid messages even when some fail

## 🏗️ Architecture

```
┌─────────────┐
│   Producer  │
│  (Orders)   │
└──────┬──────┘
       │
       ▼
┌──────────────────┐         ┌─────────────────┐
│  order-events    │────────▶│ Order Processor │
│     (Topic)      │         │   (Consumer)    │
└──────────────────┘         └────────┬────────┘
                                      │
                           ┌──────────┴──────────┐
                           │                     │
                      ✅ Success            ❌ Failure
                           │                     │
                           ▼                     ▼
                    ┌─────────────┐      ┌─────────────┐
                    │  Complete   │      │ Retry Topic │
                    └─────────────┘      └──────┬──────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │Retry Consumer│
                                         │ (Backoff)    │
                                         └──────┬───────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                            Retry < 3 Max               Retry >= 3
                                    │                       │
                                    ▼                       ▼
                            ┌──────────────┐        ┌─────────────┐
                            │ Back to Main │        │     DLQ     │
                            │    Topic     │        │   (Final)   │
                            └──────────────┘        └─────────────┘
```

## 🔄 How It Works

### 1. **Order Processing**
When an order is received, the main consumer validates:
- Delivery address is not empty
- Restaurant ID is not "offline-restaurant" (simulates API failure)

### 2. **Failure Handling**
If validation fails:
1. Message is sent to `order-retry` topic with retry metadata
2. Retry count is incremented
3. Exponential backoff timestamp is calculated
4. Error message is attached to headers

### 3. **Retry Processing**
The retry consumer:
1. Reads message from retry topic
2. Checks the retry timestamp
3. Waits for the calculated delay period
4. Republishes message to main topic for reprocessing

### 4. **Dead Letter Queue**
After 3 failed attempts:
1. Message is sent to `order-events-dlq` topic
2. Original message, error details, and retry count are preserved
3. DLQ monitor logs the failed message for manual review

## ⏱️ Exponential Backoff Strategy

The retry delay follows an exponential pattern: **2^n seconds**

| Retry Attempt | Formula | Delay | Cumulative Time |
|--------------|---------|-------|-----------------|
| 1st attempt  | 2^0     | 1s    | 1s              |
| 2nd attempt  | 2^1     | 2s    | 3s              |
| 3rd attempt  | 2^2     | 4s    | 7s              |
| DLQ (final)  | -       | -     | -               |

**Why Exponential Backoff?**
- ✅ Gives failing services time to recover
- ✅ Reduces load on downstream systems
- ✅ Prevents thundering herd problem
- ✅ Industry best practice (used by AWS, Azure, Google Cloud)

### Customizing Backoff

To adjust the backoff formula, modify the calculation in `handleFailure()`:

```javascript
// Current: 2^n seconds
const delaySeconds = Math.pow(2, retryCount);

// Alternative: 3^n seconds (faster growth)
const delaySeconds = Math.pow(3, retryCount);

// With maximum cap: max 30 seconds
const delaySeconds = Math.min(Math.pow(2, retryCount), 30);

// Linear backoff: n * 5 seconds
const delaySeconds = (retryCount + 1) * 5;
```

## 🛠️ Prerequisites

- **Node.js** v14+ and npm
- **Docker** and Docker Compose
- **Apache Kafka** 4.0.0 (via Docker)
- **KafkaJS** v2.0.0+

## 📦 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd kafka-test
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Kafka (Docker)

```bash
docker-compose up -d
```

Verify Kafka is running:

```bash
docker ps
```

You should see the `kafka` container running on port `9092`.

## ⚙️ Configuration

### Kafka Configuration (`compose.yaml`)

The Docker Compose file sets up Kafka in KRaft mode (without Zookeeper):

```yaml
services:
  kafka:
    image: bitnamilegacy/kafka:4.0.0-debian-12-r10
    ports:
      - "9092:9092"
    environment:
      - KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE=true  # Auto-create topics
      - KAFKA_CFG_OFFSETS_TOPIC_REPLICATION_FACTOR=1
```

### Application Configuration (`app.js`)

```javascript
const kafka = new Kafka({
  clientId: "food-delivery-app",
  brokers: ["localhost:9092"],
});

// Topics
const orderTopic = "order-events";
const retryTopic = "order-retry";
const dlqTopic = "order-events-dlq";

// Retry settings
const maxRetries = 3;  // Adjust as needed
```

## 🚀 Usage

### Start the Application

```bash
npm start
```

### Expected Output

```
🚀 Starting Kafka Order Processing System...

Sending test orders...

✅ Processing order 001 for John

⚠️  Retry attempt 1/3 in 1s: Invalid delivery address
⏳ Waiting 1s before retry...
🔄 Retrying message now...

⚠️  Retry attempt 2/3 in 2s: Invalid delivery address
⏳ Waiting 2s before retry...
🔄 Retrying message now...

⚠️  Retry attempt 3/3 in 4s: Invalid delivery address
⏳ Waiting 4s before retry...
🔄 Retrying message now...

❌ Max retries reached. Sending to DLQ: Invalid delivery address

💀 DLQ Message Received:
{
  "originalMessage": "{\"orderId\":\"002\",\"customerName\":\"Jane\",...}",
  "error": "Invalid delivery address",
  "timestamp": "2025-10-06T12:12:28.662Z",
  "retryAttempts": 3
}
```

## 📬 Topics

### 1. `order-events` (Main Topic)
- **Purpose**: Primary order processing queue
- **Producers**: Order service, Retry consumer
- **Consumers**: Order processor
- **Partitions**: 1 (auto-created)

### 2. `order-retry` (Retry Topic)
- **Purpose**: Temporary queue for failed messages
- **Producers**: Order processor (on failure)
- **Consumers**: Retry processor
- **Partitions**: 1 (auto-created)

### 3. `order-events-dlq` (Dead Letter Queue)
- **Purpose**: Permanent storage for unrecoverable failures
- **Producers**: Retry handler (after max retries)
- **Consumers**: DLQ monitor
- **Partitions**: 1 (auto-created)

### Creating Topics Manually (Optional)

If auto-creation is disabled:

```bash
docker exec -it kafka kafka-topics.sh --create \
  --topic order-events \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1

docker exec -it kafka kafka-topics.sh --create \
  --topic order-retry \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1

docker exec -it kafka kafka-topics.sh --create \
  --topic order-events-dlq \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1
```

### List All Topics

```bash
docker exec -it kafka kafka-topics.sh --list \
  --bootstrap-server localhost:9092
```

## 📨 Message Flow

### Successful Order Flow

```
Order → order-events → Validation ✅ → Processing Complete
```

### Failed Order Flow (with Retries)

```
Order → order-events → Validation ❌
  ↓
order-retry (1s delay) → order-events → Validation ❌
  ↓
order-retry (2s delay) → order-events → Validation ❌
  ↓
order-retry (4s delay) → order-events → Validation ❌
  ↓
order-events-dlq (Final)
```

## 🚨 Error Handling

### Error Types

1. **Invalid Delivery Address**: Empty or missing address field
2. **Restaurant API Offline**: Restaurant ID matches "offline-restaurant"

### Message Headers

Each retried message includes:

```javascript
{
  "retry-count": "2",                    // Current retry attempt
  "retry-timestamp": "1728217347895",    // Unix timestamp for next retry
  "error": "Invalid delivery address",   // Error message
  "original-topic": "order-events"       // Source topic
}
```

### DLQ Message Format

```json
{
  "originalMessage": "{...}",    // Original order JSON
  "error": "Error description",
  "timestamp": "2025-10-06T...",
  "retryAttempts": 3
}
```

## 🏭 Production Considerations

### 1. **Increase Partitions**
For high throughput, increase partition count:

```bash
--partitions 10 --replication-factor 3
```

### 2. **Consumer Groups**
Scale horizontally by adding more consumer instances with the same `groupId`.

### 3. **Security**
Enable SSL/SASL authentication:

```javascript
const kafka = new Kafka({
  clientId: "food-delivery-app",
  brokers: ["kafka-broker:9093"],
  ssl: true,
  sasl: {
    mechanism: "scram-sha-256",
    username: process.env.KAFKA_USER,
    password: process.env.KAFKA_PASS,
  },
});
```

### 4. **Monitoring**
Integrate with monitoring tools:
- **Prometheus**: Kafka exporter for metrics
- **Grafana**: Dashboards for visualization
- **ELK Stack**: Centralized logging
- **PagerDuty/Opsgenie**: Alerts for DLQ messages

### 5. **DLQ Replay**
Implement a mechanism to replay DLQ messages after fixing issues:

```javascript
// In monitorDLQ function
if (shouldReplay(deadMessage)) {
  await producer.send({
    topic: orderTopic,
    messages: [{ value: deadMessage.originalMessage }]
  });
}
```

### 6. **Idempotency**
Ensure order processing is idempotent to handle duplicate messages safely.

### 7. **Graceful Shutdown**
Add signal handlers for clean shutdown:

```javascript
process.on('SIGTERM', async () => {
  await consumer.disconnect();
  await producer.disconnect();
});
```

## 📊 Monitoring

### Key Metrics to Track

1. **Message Processing Rate**: Orders processed per second
2. **Retry Rate**: Percentage of messages requiring retries
3. **DLQ Rate**: Messages ending up in DLQ
4. **Processing Latency**: Time from message arrival to completion
5. **Consumer Lag**: Offset difference between producer and consumer

### Viewing Consumer Groups

```bash
docker exec -it kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group order-processing-group
```

### Monitoring DLQ Messages

```bash
docker exec -it kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic order-events-dlq \
  --from-beginning
```

## 🔧 Troubleshooting

### Issue: Connection Refused (ECONNREFUSED)

**Cause**: Kafka broker not running or wrong port

**Solution**:
```bash
# Check if Kafka is running
docker ps | grep kafka

# Check Kafka logs
docker logs kafka

# Restart Kafka
docker-compose restart kafka
```

### Issue: Topics Not Auto-Creating

**Cause**: Auto-create disabled or permission issues

**Solution**:
```bash
# Verify auto-create setting
docker exec -it kafka kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --describe --entity-type brokers --all

# Manually create topics (see Topics section)
```

### Issue: Messages Stuck in Retry Loop

**Cause**: Retry timestamp calculation or consumer not running

**Solution**:
```bash
# Check retry consumer logs
# Verify retry-timestamp header is set correctly
# Check system clock synchronization
```

### Issue: High Memory Usage

**Cause**: Large number of unprocessed messages

**Solution**:
- Increase consumer parallelism
- Add more partitions
- Implement backpressure mechanisms

## 📚 Additional Resources

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [KafkaJS Documentation](https://kafka.js.org/)
- [Kafka Retry Pattern Best Practices](https://www.confluent.io/blog/error-handling-patterns-in-kafka/)
- [Exponential Backoff Algorithm](https://en.wikipedia.org/wiki/Exponential_backoff)

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

Created as a demonstration of production-ready Kafka retry patterns with exponential backoff and DLQ.

---

**Note**: This implementation is designed for educational purposes and as a starting point for production systems. Always test thoroughly and adjust configurations based on your specific requirements.
