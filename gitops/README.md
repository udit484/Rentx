# GitOps
Keep deployment manifests/image versions in a separate GitOps repository. Jenkins publishes immutable images and updates the desired image tag. Argo CD detects the Git change and syncs Kubernetes. Production changes should be auditable through Git.
