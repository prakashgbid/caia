#!/bin/bash

# This script deploys the application to Google Cloud Platform

# Exit on error
set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
FRONTEND_IMAGE="gcr.io/${PROJECT_ID}/roulette-advisor-frontend:latest"
BACKEND_IMAGE="gcr.io/${PROJECT_ID}/roulette-advisor-backend:latest"

# Check if project ID is set
if [ -z "$PROJECT_ID" ]; then
  echo "Error: GCP_PROJECT_ID environment variable is not set"
  echo "Please set it with: export GCP_PROJECT_ID=your-project-id"
  exit 1
fi

# Build and push Docker images
echo "Building and pushing Docker images..."

# Build and push frontend
(cd apps/frontend &&  docker build -t $FRONTEND_IMAGE -f ../../infrastructure/docker/frontend.Dockerfile . &&  docker push $FRONTEND_IMAGE)

# Build and push backend
(cd apps/backend &&  docker build -t $BACKEND_IMAGE -f ../../infrastructure/docker/backend.Dockerfile . &&  docker push $BACKEND_IMAGE)

# Update Kubernetes manifests with correct project ID
echo "Updating Kubernetes manifests..."
sed -i "s|gcr.io/PROJECT_ID/|gcr.io/${PROJECT_ID}/|g" infrastructure/gcp/kubernetes/*.yaml

# Apply Kubernetes manifests
echo "Applying Kubernetes manifests..."
kubectl apply -f infrastructure/gcp/kubernetes/

echo "Deployment completed successfully!"
