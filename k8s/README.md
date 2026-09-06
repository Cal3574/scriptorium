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
| `kustomization.yaml`         | The deployable set + the `images:` tag block CI bumps per release.         |

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

# 4. Everything else, rendered through kustomize (k8s/kustomization.yaml)
kubectl apply -k k8s/
kubectl -n scriptorium rollout status statefulset/postgres
kubectl -n scriptorium wait --for=condition=complete job/migrator --timeout=120s
```

`kubectl apply -k` applies the migrator Job alongside the rest; with plain
`kubectl` (no ArgoCD) it does not enforce PreSync ordering, so the api/worker
pods may restart a few times waiting on the schema. That is why the manual
flow above waits on the Job before moving on. ArgoCD does honour the hook.

## Handing it to ArgoCD instead

```sh
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres/secret.yaml -f k8s/shared/secret.yaml   # still out of band
kubectl apply -n argocd -f argocd/application.yaml
```

ArgoCD renders `k8s/` with kustomize, applies every manifest
`kustomization.yaml` lists (the `*.example.yaml` templates are omitted), and
runs the migrator as a PreSync hook on every sync.

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
