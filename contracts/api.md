# Public API Contract (egress)

REST + WebSocket surface the frontend consumes. Owned by whoever builds each endpoint — they write their own contract entries.

Any change that alters or removes an existing field/endpoint (not just adds a new optional one): prefix the PR title `BREAKING:` and flag it in `#api-contract`, don't just merge it as a routine notice.

Entry template:

```
### METHOD /path          (or "### WS /path" for a WebSocket stream)
**Owner:** 
**Type:** REST | WebSocket
**Payload:**
{
}
**Notes:** 
```

---

<!-- Add entries below, one per endpoint -->
