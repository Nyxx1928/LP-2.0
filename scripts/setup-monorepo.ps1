Write-Host "Installing root dependencies..."
pnpm install

Write-Host "Starting local infrastructure..."
docker compose -f infra/docker/docker-compose.dev.yml up -d

Write-Host "Bootstrap complete. Next: scaffold backend and storefront apps."
