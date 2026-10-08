# RUN.md — Run RentX Application First

This guide deliberately gets the application running before Jenkins, SonarQube, Trivy, Kubernetes or GitOps. Use an AWS Ubuntu EC2 instance for the first run if that is your target environment.

## 1. Connect to EC2
```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

Install Git, Node and Docker:
```bash
sudo apt update
sudo apt install -y git curl unzip
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Get the project
```bash
git clone https://github.com/udit484/rentx.git
cd rentx
```
If the repository is not public yet, copy the project to EC2 or clone your own private repository using your normal Git authentication.

## 3. Run the frontend directly first
```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```
Open `http://YOUR_EC2_PUBLIC_IP:3000`.

For this first frontend-only run, the dashboard uses mock data and AI interactions. This proves the UI works before backend integration.

## 4. Production-like frontend container
From the project root:
```bash
docker build -t rentx-frontend:dev ./frontend
docker run -d --name rentx-frontend -p 3000:80 rentx-frontend:dev
curl http://localhost:3000/health
```
Expected response:
`rentx-frontend: healthy`

Open:
`http://YOUR_EC2_PUBLIC_IP:3000`

## 5. AWS security group for the first test
Temporarily allow TCP 3000 from your own IP. Keep SSH 22 restricted to your IP. Do not expose PostgreSQL, Redis, Jenkins, SonarQube, Prometheus or Alertmanager publicly.

## 6. Next implementation stages
### Stage A — Application
Implement API Gateway + auth/user/product/booking/payment/notification services and PostgreSQL/Redis.

### Stage B — Quality
Add unit tests and SonarQube. Jenkins pipeline:
`checkout → install → test → SonarQube → quality gate`

### Stage C — Security
Add Trivy filesystem scan and image scan. Fail the pipeline on the severity policy you define.

### Stage D — Containers
Create Dockerfiles for every service and Docker Compose for developer integration testing.

### Stage E — Kubernetes
Create Deployments, Services, ConfigMaps, Secrets, Ingress, probes, resource requests/limits and HPA.

### Stage F — Monitoring
Expose `/metrics` from services. Prometheus scrapes them; Grafana dashboards visualize them; Alertmanager sends email/Slack alerts.

### Stage G — GitOps
Jenkins builds and pushes images, then updates the GitOps repository. Argo CD watches that repository and synchronizes Kubernetes.

### Stage H — AWS/IaC
Use Terraform for VPC, subnets, security groups, IAM, EC2/EKS or your chosen Kubernetes environment, load balancing and supporting resources.

## 7. Recommended EC2 layout
For learning, start small and separate components as resource usage grows:
- App/Kubernetes node: application workloads
- CI node: Jenkins
- Observability node: Prometheus/Grafana/Alertmanager
- SonarQube can share CI initially, but move it when memory pressure appears

For Kubernetes learning on EC2, you can first use kind for fast iteration, then reproduce the architecture on a real cluster. For an AWS production-style implementation, EKS is the natural later stage.

## 8. Never commit secrets
Before `git add .`, check:
```bash
git status
git diff --cached
```
Do not commit `.env`, AWS access keys, PEM files, kubeconfig files, passwords, JWT secrets, payment credentials or Slack/SMTP secrets.
