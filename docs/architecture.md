# Architecture
Users → Ingress/API Gateway → domain microservices → PostgreSQL/Redis/external payment provider. Notifications/events are asynchronous where useful. AI assistant/recommendation APIs remain separate so they can scale independently. Observability is cross-cutting: metrics, logs, traces and alerts.
