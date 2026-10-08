# Monitoring
Services expose Prometheus metrics. Prometheus scrapes them, Grafana visualizes RED/USE metrics, and Alertmanager routes alerts to email/Slack. Suggested alerts: high 5xx, latency, pod restarts, CPU/memory pressure, unavailable replicas and dependency failures.
