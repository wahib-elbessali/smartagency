# Ingestion Contract (internal)

Endpoints the backend exposes to receive events from the IoT/AI layer. Owned by whoever builds the piece producing the event — not a dedicated contract-owner role.

Any change that alters or removes an existing field/endpoint (not just adds a new optional one): prefix the PR title `BREAKING:` and flag it in `#api-contract`, don't just merge it as a routine notice.

Entry template:

```
### METHOD /path
**Owner:** 
**Type:** REST internal ingestion
**Payload:**
{
}
**Notes:** 
```

---

<!-- Add entries below, one per endpoint -->
