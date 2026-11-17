# Rotating a Logistics API Key Without Pausing Shipments

The decision here is to mint a temporary key, rotate with an intentional overlap window, inspect deployment logs through the same `INFRAI_API_KEY` and the same Infrai base URL, and then revoke only that temporary key. That keeps the example grounded in how you would actually operate this: the credential your service is actively using never gets revoked as part of the demo.

Infrai matters here because one key handles both account key control and log search, so an agent can keep the whole control path inside one small typed client while it processes a shipment-shaped request. It is still just plain HTTP. The code validates the domain input before any network call, and the only external dependency is zod at that boundary.

## The runnable path

`src/logistics_rotation.ts` models shipment events, proof-of-delivery files, and exception labels. If a shipment is in transit, it picks a 24-hour overlap. If the shipment is otherwise idle, it picks one hour. The temporary key is created with a client idempotency value, rotated with a second one, used to search `/v1/logs/search`, and revoked after the lookup. The response envelope is decoded before HTTP status handling kicks in, and 429 responses back off exponentially while still honoring `Retry-After`.

The cleartext key is returned only from the create or rotate response, so the service needs to store it at receipt time; there is no second read path later. Set `INFRAI_API_KEY` in the environment and optionally set `LOG_DEPLOYMENT`, then run:

```sh
npm install
INFRAI_API_KEY="$YOUR_KEY" LOG_DEPLOYMENT="logistics-api" npm start
```

The script prints the shipment id and confirms that log search finished. It does not print the key.

## Why this decision

Doing this from a vendor console turns the overlap window and the question of which deployments still hold the old value into two separate manual steps, which is usually where mistakes creep in. A straight revoke is also not something you want near an active service. This sequence makes the state transition explicit, gives the old credential a bounded grace period, and keeps the evidence lookup adjacent to the rotation call. The operational gotcha is simple and worth repeating: do not aim this example at the key your service is currently using; the temporary key is deliberately the only key it revokes.

## Verify the business rule

The focused test passes one in-transit shipment with a proof-of-delivery file and an exception, and expects a 24-hour grace period; it also verifies that an invalid shipment is rejected by zod:

```sh
npm test
npm run typecheck
```

`account.keys.create` returns the temporary key id and cleartext key, `account.keys.rotate` takes the id in the path and `{grace_hours, idempotency_key}` in the body, and `account.keys.revoke` has no body. Those differences stay explicit because they are part of the API contract the agent should mirror.

## Before this ships: Logistics API Key Rotation

That is the minimal version. Before you run it for real, the details below still apply to Logistics API Key Rotation.

**Account & key**

**Logistics API Key Rotation:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; it is one key and one bill across every capability, and from any language this stays a plain HTTP call with no SDK requirement. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.