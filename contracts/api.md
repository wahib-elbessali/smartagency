# Public API Contract (egress)

REST + WebSocket surface the frontend consumes. Owned by Ahmed — he builds these endpoints, so he writes their contract entries himself.

Any change that alters or removes an existing field/endpoint (not just adds a new optional one): prefix the PR title `BREAKING:` and flag it in `#api-contract`, don't just merge it as a routine notice.

Entry template:

```
### METHOD /path          (or "### WS /path" for a WebSocket stream)
**Owner:** Ahmed
**Type:** REST | WebSocket
**Payload:**
{
}
**Notes:** 
```

---

<!-- Add entries below, one per endpoint -->

## Climate

<!-- GET current temp/humidity, etc. -->

## Employee presence

<!-- GET presence/occupancy state -->

## Visitor queue / kiosk

<!-- GET queue stats, POST ticket issuance -->

## WS /live-map

<!-- bird's-eye-view person tracking stream -->

## WS /alerts

<!-- weapon/abandoned-object/wanted-person alert stream -->
