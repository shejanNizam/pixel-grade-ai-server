import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { ShippoService, SHIP_FROM_ADDRESS } from "../src/app/services/shippo.service";

async function runCheck() {
  console.log("--------------------------------------------------");
  console.log("Shippo API Probe & Diagnostic Check");
  console.log("--------------------------------------------------");
  console.log("Ship-From Address:", SHIP_FROM_ADDRESS.street1, SHIP_FROM_ADDRESS.city, SHIP_FROM_ADDRESS.state);

  const testAddress = {
    name: "John Doe",
    street1: "112 Commercial Ct",
    city: "Santa Rosa",
    state: "CA",
    zip: "95407",
    country: "US",
  };

  try {
    console.log("Testing Address Validation & Rate Calculation...");
    const result = await ShippoService.getRatesForShipment(testAddress, 1);
    console.log("✅ Success! Shipment Created ID:", result.shipmentId);
    console.log("Available Rates Count:", result.rates.length);
    if (result.selectedRate) {
      console.log(
        `Selected USPS Rate: ${result.selectedRate.serviceLevelName} - $${result.selectedRate.amount} USD (Rate ID: ${result.selectedRate.rateId})`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Shippo Check Failed:", message);
    process.exit(1);
  }
}

runCheck();
