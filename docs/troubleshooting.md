# Troubleshooting Runbook

## Kubernetes 503
Check Ingress → Service endpoints → pod readiness → container port → application health. `kubectl get endpoints`, `kubectl describe ingress`, `kubectl logs` and readiness probes are key checks.

## High CPU
Check Grafana/Prometheus, identify pod/service, inspect recent deployment and scale with HPA if load is legitimate. Roll back if caused by a release.

## CrashLoopBackOff
Check `kubectl describe pod`, previous logs, environment/config/secrets, probes and resource limits.

## Malicious IP
Prefer AWS WAF/IP set at the internet edge for an internet-facing application; document the rule change and monitor false positives.
