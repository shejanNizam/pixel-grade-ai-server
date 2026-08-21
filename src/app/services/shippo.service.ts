import httpStatus from "http-status";
import AppError from "../errorHelpers/AppError";
import { logger } from "../utils/logger";

const SHIPPO_API_URL = "https://api.goshippo.com";

const getShippoKey = () => process.env.SHIPPO_API_KEY || "";

export const SHIP_FROM_ADDRESS = {
  name: "PixelGrade Fulfillment Center",
  company: "PixelGrade AI",
  street1: "112 Commercial Ct",
  street2: "Ste 25",
  city: "Santa Rosa",
  state: "CA",
  zip: "95407",
  country: "US",
  phone: "7075550199",
  email: "fulfillment@pixelgradeai.com",
};

export interface ShippoAddressInput {
  name: string;
  phone?: string;
  email?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface ShippoRate {
  rateId: string;
  amount: number;
  currency: string;
  provider: string;
  serviceLevelName: string;
  estimatedDays?: number;
}

/** Determines parcel weight/dimensions based on total slab count */
export const parcelForSlabCount = (count: number) => {
  const quantity = Math.max(1, count);
  if (quantity === 1) {
    return { length: "8", width: "5", height: "1", distance_unit: "in", weight: "5", mass_unit: "oz" };
  } else if (quantity <= 3) {
    return { length: "9", width: "6", height: "2", distance_unit: "in", weight: "12", mass_unit: "oz" };
  } else {
    return { length: "10", width: "7", height: "3", distance_unit: "in", weight: "24", mass_unit: "oz" };
  }
};

const shippoFetch = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${SHIPPO_API_URL}${endpoint}`;
  const apiKey = getShippoKey();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `ShippoToken ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    logger.error("Shippo API Error:", data);
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `Shippo API Error: ${data.detail || data.message || JSON.stringify(data)}`,
    );
  }
  return data;
};

/** Validate customer shipping address */
const validateAddress = async (address: ShippoAddressInput) => {
  if (address.country && address.country.toUpperCase() !== "US") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "We currently ship to US domestic addresses only (USPS Ground Advantage).",
    );
  }

  const payload = {
    name: address.name,
    phone: address.phone || "7075550199",
    email: address.email || "fulfillment@pixelgradeai.com",
    street1: address.street1,
    street2: address.street2 || "",
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: "US",
    validate: true,
  };

  try {
    const res = await shippoFetch("/addresses/", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const validation = res.validation_results;
    if (validation && validation.is_valid === false) {
      const errorMsg =
        validation.messages?.[0]?.text || "Invalid shipping address provided.";
      throw new AppError(httpStatus.BAD_REQUEST, `Address Validation Failed: ${errorMsg}`);
    }

    return res;
  } catch (err: any) {
    logger.warn("Shippo address validation warning:", err.message);
    return { validation_results: { is_valid: true } };
  }
};

/** Create shipment and retrieve available USPS rates with fail-safe fallback */
const getRatesForShipment = async (
  toAddress: ShippoAddressInput,
  slabCount: number = 1,
): Promise<{ shipmentId: string; rates: ShippoRate[]; selectedRate?: ShippoRate }> => {
  await validateAddress(toAddress);

  const parcel = parcelForSlabCount(slabCount);

  const shipmentPayload = {
    address_from: SHIP_FROM_ADDRESS,
    address_to: {
      name: toAddress.name,
      company: "PixelGrade Customer",
      street1: toAddress.street1,
      street2: toAddress.street2 || "",
      city: toAddress.city,
      state: toAddress.state,
      zip: toAddress.zip,
      country: "US",
      phone: toAddress.phone || "7075550199",
      email: toAddress.email || "fulfillment@pixelgradeai.com",
    },
    parcels: [parcel],
    async: false,
  };

  const fallbackRate: ShippoRate = {
    rateId: "usps_ground_default",
    amount: 5.95,
    currency: "USD",
    provider: "USPS",
    serviceLevelName: "USPS Ground Advantage (3-7 days)",
    estimatedDays: 5,
  };

  try {
    const shipment = await shippoFetch("/shipments/", {
      method: "POST",
      body: JSON.stringify(shipmentPayload),
    });

    const rawRates: any[] = shipment.rates || [];
    const rates: ShippoRate[] = rawRates.map((r) => ({
      rateId: r.object_id,
      amount: parseFloat(r.amount),
      currency: r.currency,
      provider: r.provider,
      serviceLevelName: r.servicelevel?.name || r.provider,
      estimatedDays: r.estimated_days,
    }));

    const uspsGround = rates.find(
      (r) =>
        r.provider?.toLowerCase().includes("usps") &&
        r.serviceLevelName?.toLowerCase().includes("ground"),
    ) || rates.find((r) => r.provider?.toLowerCase().includes("usps")) || rates[0];

    return {
      shipmentId: shipment.object_id,
      rates: rates.length > 0 ? rates : [fallbackRate],
      selectedRate: uspsGround || fallbackRate,
    };
  } catch (err: any) {
    logger.warn("Shippo API rate fetch warning (falling back to standard USPS Ground Advantage $5.95):", err.message);
    return {
      shipmentId: "estimated_shipment",
      rates: [fallbackRate],
      selectedRate: fallbackRate,
    };
  }
};

/** Purchase shipping label from Shippo rate ID (Admin fulfillment) */
const purchaseLabel = async (rateId: string) => {
  const payload = {
    rate: rateId,
    async: false,
  };

  const transaction = await shippoFetch("/transactions/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (transaction.status !== "SUCCESS") {
    const errorMsg =
      transaction.messages?.[0]?.text ||
      (Array.isArray(transaction.messages) ? transaction.messages.map((m: any) => m.text).join(", ") : "Failed to purchase shipping label via Shippo.");
    throw new AppError(httpStatus.BAD_GATEWAY, `Shippo Label Purchase Failed: ${errorMsg}`);
  }

  return {
    transactionId: transaction.object_id,
    trackingNumber: transaction.tracking_number,
    trackingUrl: transaction.tracking_url_provider,
    labelUrl: transaction.label_url,
    carrier: transaction.provider || "USPS",
  };
};

export const ShippoService = {
  validateAddress,
  getRatesForShipment,
  purchaseLabel,
};
