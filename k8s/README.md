# Scriptorium on Kubernetes

Every object lives in the `scriptorium` namespace.
ArgoCD (`argocd/application.yaml`) reconciles this directory on the `main` branch; the steps below are the equivalent manual apply, useful for a first bring-up or a throwaway cluster.

## Layout

| Path                         | What it is                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `namespace.yaml`             | The `scriptorium` namespace.                                               |
| `shared/configmap.yaml`      | Non-secret env shared by api + worker (`app-config`).                      |
| `shared/secret.example.yaml` | Template for `app-secrets` (DB URL, Redis URL, Clerk, provider keys, AWS). |
| `postgres/`                  | Postgres + pgvector StatefulSet, headless Service, secret template.        |
| `redis/`                     | Redis Deployment (PVC-backed) + Service - the BullMQ broker.               |
| `api/`                       | NestJS API Deployment + ClusterIP Service (port 3000, `/health` probe).    |
| `worker/`                    | BullMQ consumer Deployment. No Service, no HTTP probe.                     |
| `client/`                    | Static SPA (nginx) Deployment + Service (`/healthz` probe).                |
| `migrator/job.yaml`          | drizzle migration Job. ArgoCD Sync hook, sync-wave 1 (after the DB).       |
| `ingress.yaml`               | Traefik Ingress. `/api` + `/health` -> api, `/` -> client.                 |
| `kustomization.yaml`         | The deployable set + the `images:` tag block CI bumps per release.         |
| `bootstrap/`                 | One-time cluster-scoped setup, applied by hand (not in the kustomization). |

## Cluster prerequisites

One-time setup on the cluster, none of it namespaced to `scriptorium`:

1. **DNS** - an `A` record for `scriptorium-ai.com` pointing at the k3s
   node's public IP. HTTP-01 cert issuance and all ingress traffic depend on
   it resolving.

2. **cert-manager + the ClusterIssuer** - see the header of
   `bootstrap/cluster-issuer.yaml`. Install cert-manager, set a real `email:`
   in that file, then `kubectl apply -f k8s/bootstrap/cluster-issuer.yaml`.
   `ingress.yaml` refers to it as `letsencrypt-prod`.

3. **GHCR pull secret** - the `scriptorium-*` packages are private, and every
   workload pod references an `imagePullSecrets` entry named `ghcr-pull`.
   Create it once in the namespace with a GitHub PAT (classic, scope
   `read:packages`) or a fine-grained token with package read:

   ```sh
   kubectl -n scriptorium create secret docker-registry ghcr-pull \
     --docker-server=ghcr.io \
     --docker-username=<github-username> \
     --docker-password=<PAT> \
     --docker-email=<any-email>
   ```

## First-time bring-up

```sh
# 1. Namespace
kubectl apply -f k8s/namespace.yaml

# 2. Secrets - fill in the real values first (never committed).
#    ghcr-pull: see "Cluster prerequisites" above.
cp k8s/postgres/secret.example.yaml k8s/postgres/secret.yaml
cp k8s/shared/secret.example.yaml   k8s/shared/secret.yaml
$EDITOR k8s/postgres/secret.yaml k8s/shared/secret.yaml   # POSTGRES_PASSWORD must match DATABASE_URL
kubectl apply -f k8s/postgres/secret.yaml -f k8s/shared/secret.yaml

# 3. Non-secret config - set the real host in API_URL / CLIENT_ORIGIN / ingress.yaml
kubectl apply -f k8s/shared/configmap.yaml

# 4. Everything else, rendered through kustomize (k8s/kustomization.yaml)
kubectl apply -k k8s/
kubectl -n scriptorium rollout status statefulset/postgres
kubectl -n scriptorium wait --for=condition=complete job/migrator --timeout=120s
```

`kubectl apply -k` applies everything at once; plain `kubectl` (no ArgoCD)
ignores the sync-wave annotations, so the migrator and the api/worker pods
race Postgres coming up. Their `wait-for-*` init containers absorb most of
that, and the explicit waits above cover the rest. ArgoCD honours the waves:
Postgres/Redis (0), migrator (1), apps (2).

## Handing it to ArgoCD instead

```sh
kubectl apply -f k8s/namespace.yaml
# secrets + ghcr-pull still out of band (see "Cluster prerequisites")
kubectl apply -f k8s/postgres/secret.yaml -f k8s/shared/secret.yaml
kubectl apply -n argocd -f argocd/application.yaml
```

ArgoCD renders `k8s/` with kustomize, applies every manifest
`kustomization.yaml` lists (the `*.example.yaml` templates are omitted), and
runs the migrator as a Sync hook in sync-wave 1 - after Postgres and Redis
(wave 0) are healthy, before the app Deployments (wave 2).

## Container images

Built by `.github/workflows/release.yml` on every push to `main`: it builds
`docker/*.Dockerfile`, pushes `ghcr.io/<owner>/scriptorium-<svc>:<sha>` (plus
`:latest`), then runs `kustomize edit set image` in this directory and commits
the tag bump. ArgoCD syncs the new tags. The `images:` block in
`kustomization.yaml` is the source of truth for what is deployed;
`newTag: latest` is the placeholder until the first release runs.

The client image is environment-specific - `VITE_API_URL` and
`VITE_CLERK_PUBLISHABLE_KEY` are inlined at build time from repo secrets of
the same name (not sensitive, but kept as secrets so the build log masks
them).
