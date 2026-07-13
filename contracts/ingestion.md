# Ingestion Contract (internal)

Endpoints Ahmed's backend exposes to receive events from the IoT/AI glue code. Owned by whoever builds the piece producing the event (Wahib/Basma) — not a dedicated contract-owner role.

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

## Hardware / sensors

<!-- e.g. DHT22 climate readings, MQ-7 gas readings -->

## Access control

<!-- e.g. RC522 badge scans, lock/motor state changes -->

## AI / CV events

<!-- e.g. weapon/abandoned-object detections, tracking frames, facial recognition matches -->
