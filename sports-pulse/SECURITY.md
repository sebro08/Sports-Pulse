# Security Policy

## Reportar una vulnerabilidad
Abre un "Security advisory" privado en GitHub (pestana Security del repositorio). No publiques detalles en issues.

## Versiones soportadas
Solo la rama `main`.

## Practicas
- Sin secretos en Git: `.env` ignorado, `.env.example` solo con nombres.
- En produccion: Azure Key Vault + Managed Identity (ver docs/architecture.md).
- Dependabot, CodeQL y Trivy se activan en la Fase de CI/CD.
