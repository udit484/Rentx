# Jenkins Pipeline
Target pipeline: checkout → dependency install → unit tests → SonarQube analysis → quality gate → Trivy filesystem scan → Docker build → Trivy image scan → push registry → update GitOps image tag. Store credentials in Jenkins Credentials, never in Git.
