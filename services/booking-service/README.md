# booking-service

Planned port: 5004. Implement as an independently deployable microservice with , , unit tests, Dockerfile and Kubernetes Deployment/Service. Keep business logic isolated and communicate through APIs/events rather than shared database tables.

## DevOps contract
- Unit tests required before merge
- SonarQube quality gate
- Trivy filesystem and image scanning
- Docker image tagged with Git SHA
- Kubernetes readiness/liveness probes
- Prometheus metrics
- Structured JSON logs
