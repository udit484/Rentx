# RentX — AI-Enhanced Rental Marketplace

RentX is a real-world rental marketplace where users can list and rent everyday products by hour/day/week/month. It is intentionally designed as a DevOps showcase: the application begins as normal source code and is progressively containerized, tested, scanned, deployed to Kubernetes, monitored and GitOps-managed.

## Business capabilities
- Signup/login and role-based renter/owner/admin flows
- Product listing, images, pricing and availability
- Search by product, category and city/location
- Hourly/daily/weekly/monthly booking
- Payments, security deposit and refunds
- Notifications and user-to-user chat
- Reviews, ratings and wishlist
- Dispute/admin workflows
- AI rental assistant and personalized recommendations

## DevOps target architecture
GitHub → Jenkins → Unit Tests → SonarQube Quality Gate → Trivy FS Scan → Docker Build → Trivy Image Scan → Registry → GitOps Repo → Argo CD → Kubernetes → Prometheus → Grafana → Alertmanager → Email/Slack

## Services
`auth-service` 5001, `user-service` 5002, `product-service` 5003, `booking-service` 5004, `payment-service` 5005, `notification-service` 5006. API Gateway: 8080. Frontend: 3000.

Supporting tools: PostgreSQL 5432, Redis 6379, Jenkins 8081, SonarQube 9000, Prometheus 9090, Grafana 3001, Alertmanager 9093.

## AWS approach
Use Ubuntu 24.04 LTS EC2. For the complete toolchain, use separate instances or increase instance size as the stack grows. Keep PostgreSQL, Redis, Jenkins, SonarQube, Prometheus and Alertmanager private/restricted. Public access should normally be through the application load balancer/Ingress only. Never commit credentials, AWS keys, private keys, kubeconfigs, payment secrets or webhook secrets.

## Build order
1. Run the application locally/on EC2 without containers.
2. Add unit tests.
3. Add Dockerfiles and Compose.
4. Jenkins: checkout → test → SonarQube → Trivy → build → push.
5. Deploy to Kubernetes with Deployments, Services, ConfigMaps and Secrets.
6. Add Ingress, HPA and resource limits.
7. Add Prometheus/Grafana/Alertmanager and alerts.
8. Move deployment to GitOps: Jenkins updates image metadata in Git; Argo CD syncs Kubernetes.
9. Add Terraform for AWS infrastructure.
10. Demonstrate incidents: 503, CrashLoopBackOff, high CPU, failed probes, bad image, unavailable dependency and malicious IP blocking.

## Important production pattern
Jenkins should build/test/scan/publish artifacts. It should not directly change production Kubernetes. Target flow: Jenkins → registry → GitOps repository → Argo CD → Kubernetes.

See `RUN.md` for the first application run, then the tool-specific READMEs under each directory.
