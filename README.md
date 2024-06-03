# Brer

Invoker component for Brer project.

## Overview

Just spawn Invocations' Pods.

This process will issue authorization tokens for any Pod.

## Setup

### Dependencies

- [Node.js](https://nodejs.org/) v20.6.0 or later
- A Kubernetes cluster ([minikube](https://minikube.sigs.k8s.io/docs/) is ok)

### Envs

Create a `.env` file with the following envs:

| Name                    | Description
| ----------------------- | -----------------------
| NODE_ENV                | Must be `"production"` for non-toy envs.
| LOG_LEVEL               | Standard Pino.js log level. Defaults to `"debug"`.
| LOG_PRETTY              | Set to `"enable"` to pretty-print logs.
| LOG_FILE                | Log filepath (optional).
| MAX_ACTIVE_INVOCATIONS  | Defaults to `10`.
| INVOKE_TIMEOUT          | Seconds, defaults to `10`.
| JWT_PRIVATE_KEY         | Filepath of a PEM-encoded RSA SHA-256 private key.
| JWT_SECRET              | JWT symmetric key.
| **API_URL**             | **Required**. Brer API server URL.
| K8S_YAML                | Raw `kubeconfig` YAML data. Has precedence over `K8S_FILE`.
| K8S_FILE                | Filepath of the `kubeconfig` file. Default to in-cluster or OS-specific.
| K8S_CONTEXT             | Expected context's name.
| K8S_CLUSTER             | Expected context's cluster.
| K8S_USER                | Expected context's user.
| K8S_NAMESPACE           | Used namespace. Defaults to context, then in-cluster env, then `"default"`.
| K8S_PULL_SECRETS        | Comma separated image pull secrets to inject into Pods.
| K8S_CPU_REQUEST         |
| K8S_MEMORY_REQUEST      |
| K8S_CPU_LIMIT           |
| K8S_MEMORY_LIMIT        |

### Start

Start the server:

```
npm start --env .env
```

For development:

```
npm run watch --env .env
```

### Test

Run:

```
npm test
```

## Acknowledgements

This project is kindly sponsored by [Evologi](https://evologi.it/).
