# Deploy Cottage Service

Cottage Service is the optional Go companion service for search, fetching, headless-browser work, screenshots, and web automation. Configure the frontend with its HTTPS address through **Settings → Cottage Service**.

Deploy it as a separate trusted component. Restrict who can reach it, protect its browser and network capabilities, manage TLS appropriately, and verify that the frontend points to the intended service address. A connection failure should remain visible to the user rather than silently switching to another endpoint.

For the conceptual role of the service, see [Cottage Service](/en/concepts/cottage-service-concepts).
