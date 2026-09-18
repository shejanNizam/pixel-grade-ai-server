import request from "supertest";
import app from "../app";
import { SlabOrderServices } from "../app/modules/slabOrder/slabOrder.service";
import { SlabOrder } from "../app/modules/slabOrder/slabOrder.model";

describe("Shippo Tracking Webhook & Status Mapping", () => {
  it("webhook endpoint /api/v1/shippo/webhook is registered and reaches the handler without requiring user auth", async () => {
    jest
      .spyOn(SlabOrderServices, "processShippoTrackingWebhook")
      .mockResolvedValue({ success: true, message: "Mocked" } as any);

    const res = await request(app)
      .post("/api/v1/shippo/webhook")
      .send({ tracking_number: "TEST_NO_ORDER", status: "TRANSIT" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    (SlabOrderServices.processShippoTrackingWebhook as jest.Mock).mockRestore();
  });

  it("handles missing tracking number gracefully", async () => {
    const result = await SlabOrderServices.processShippoTrackingWebhook({});
    expect(result.success).toBe(false);
    expect(result.message).toBe("Missing tracking number");
  });

  it("updates order status to in_transit when carrier scans package", async () => {
    const mockOrder = {
      orderNumber: "PG-TEST-001",
      trackingNumber: "9300120845500000492930",
      orderStatus: "ready_to_ship",
      status: "ready_to_ship",
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(SlabOrder, "findOne").mockResolvedValue(mockOrder as any);

    const webhookPayload = {
      event: "track_updated",
      data: {
        tracking_number: "9300120845500000492930",
        carrier: "usps",
        tracking_status: {
          status: "TRANSIT",
          status_details: "Accepted at USPS Origin Facility",
        },
      },
    };

    const result = await SlabOrderServices.processShippoTrackingWebhook(webhookPayload);

    expect(result.success).toBe(true);
    expect(mockOrder.orderStatus).toBe("in_transit");
    expect(mockOrder.status).toBe("in_transit");
    expect(mockOrder.save).toHaveBeenCalled();

    (SlabOrder.findOne as jest.Mock).mockRestore();
  });

  it("updates order status to delivered when carrier confirms delivery", async () => {
    const mockOrder = {
      orderNumber: "PG-TEST-002",
      trackingNumber: "9300120845500000492930",
      orderStatus: "in_transit",
      status: "in_transit",
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(SlabOrder, "findOne").mockResolvedValue(mockOrder as any);

    const webhookPayload = {
      event: "track_updated",
      data: {
        tracking_number: "9300120845500000492930",
        carrier: "usps",
        tracking_status: {
          status: "DELIVERED",
          status_details: "Delivered, In/At Mailbox",
        },
      },
    };

    const result = await SlabOrderServices.processShippoTrackingWebhook(webhookPayload);

    expect(result.success).toBe(true);
    expect(mockOrder.orderStatus).toBe("delivered");
    expect(mockOrder.status).toBe("delivered");
    expect(mockOrder.save).toHaveBeenCalled();

    (SlabOrder.findOne as jest.Mock).mockRestore();
  });
});
