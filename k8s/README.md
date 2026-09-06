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
| `migrator/job.yaml`          | drizzle migration Job. ArgoCD PreSync hook.                                |
| `ingress.yaml`               | Traefik Ingress. `/api` + `/health` -> api, `/` -> client.                 |

## First-time bring-up

```sh
# 1. Namespace
kubectl apply -f k8s/namespace.yaml

# 2. Secrets - fill in the real values first (never committed)
cp k8s/postgres/secret.example.yaml k8s/postgres/secret.yaml
cp k8s/shared/secret.example.yaml   k8s/shared/secret.yaml
$EDITOR k8s/postgres/secret.yaml k8s/shared/secret.yaml   # POSTGRES_PASSWORD must match DATABASE_URL
kubectl apply -f k8s/postgres/secret.yaml -f k8s/shared/secret.yaml

# 3. Non-secret config - set the real host in API_URL / CLIENT_ORIGIN / ingress.yaml
kubectl apply -f k8s/shared/configmap.yaml

# 4. Data stores
kubectl apply -f k8s/postgres/ -f k8s/redis/
kubectl -n scriptorium rollout status statefulset/postgres

# 5. Schema
kubectl apply -f k8s/migrator/job.yaml
kubectl -n scriptorium wait --for=condition=complete job/migrator --timeout=120s

# 6. App + edge
kubectl apply -f k8s/api/ -f k8s/worker/ -f k8s/client/ -f k8s/ingress.yaml
```

## Handing it to ArgoCD instead

```sh
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres/secret.yaml -f k8s/shared/secret.yaml   # still out of band
kubectl apply -n argocd -f argocd/application.yaml
```

ArgoCD then applies everything under `k8s/` (skipping `*.example.yaml`) and runs the migrator as a PreSync hook on every sync.

## Container images

The Deployments reference `scriptorium/<name>:latest` as a placeholder.
CI builds from `docker/*.Dockerfile` and rewrites the tag (or an ArgoCD image updater does).
Set the real registry path before the first deploy.
