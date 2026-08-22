# Cottage Service API

Cottage Service exposes the HTTP interface used by the frontend for optional search, fetching, browser automation, screenshots, and related operations. Its implementation lives in `cottage-service-go/`; the frontend connects to one configured HTTP address.

Deploy and secure the service before exposing it beyond a trusted environment. API fields and endpoints evolve with the service implementation; use the current source and runtime responses as the operational reference. See [Deploy Cottage Service](/en/architecture/cottage-service-deploy).
