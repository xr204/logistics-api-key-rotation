import assert from "node:assert/strict";
import { chooseRotationGrace, validateShipment } from "./logistics_rotation.ts";

const shipment = validateShipment({
  shipmentId: "SHP-100",
  events: [{ shipmentId: "SHP-100", occurredAt: "2026-01-01T00:00:00.000Z", type: "in_transit", location: "Osaka" }],
  proofOfDelivery: [{ name: "pod.jpg", contentType: "image/jpeg", checksum: "sha256:abc" }],
  exceptions: ["address_check"],
});

assert.equal(chooseRotationGrace(shipment.events), 24);
assert.throws(() => validateShipment({ shipmentId: "", events: [], proofOfDelivery: [], exceptions: [] }));
console.log("rotation decision test passed");
