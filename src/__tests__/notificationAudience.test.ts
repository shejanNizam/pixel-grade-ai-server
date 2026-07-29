import {
  NotifAudience,
  NotifType,
  TYPE_AUDIENCE,
} from "../app/modules/notification/notification.interface";
import { isStaffRole } from "../app/modules/notification/notification.service";
import { UserRole } from "../app/modules/user/user.interface";

/**
 * The audience split is an authorisation boundary, not a display preference.
 *
 * Two things have to hold, and both fail silently if broken: a staff alert must
 * never be addressable to a single customer, and a customer must never be able
 * to read the staff queue. These tests pin the declarations both rules are
 * derived from.
 */

describe("notification audience mapping", () => {
  it("classifies every type exactly once", () => {
    // A type missing from the map would resolve to `undefined` and fall through
    // the create/createForStaff guards into whichever branch ran first.
    for (const type of Object.values(NotifType)) {
      expect(Object.values(NotifAudience)).toContain(TYPE_AUDIENCE[type]);
    }

    expect(Object.keys(TYPE_AUDIENCE).sort()).toEqual(
      Object.values(NotifType).sort(),
    );
  });

  it("keeps customer-facing types on the user audience", () => {
    for (const type of [
      NotifType.grade_ready,
      NotifType.price_alert,
      NotifType.subscription,
      NotifType.support,
      NotifType.system,
    ]) {
      expect(TYPE_AUDIENCE[type]).toBe(NotifAudience.user);
    }
  });

  it("keeps operational types on the admin audience", () => {
    for (const type of [
      NotifType.support_ticket_new,
      NotifType.support_ticket_reply,
      NotifType.subscription_started,
      NotifType.subscription_payment_failed,
    ]) {
      expect(TYPE_AUDIENCE[type]).toBe(NotifAudience.admin);
    }
  });

  it("never marks a support REPLY to a customer as staff-audience", () => {
    // Easy to conflate: `support` goes to the ticket owner, while
    // `support_ticket_reply` tells staff a customer wrote back. Swapping them
    // would mail every admin about their own replies and tell the customer
    // nothing.
    expect(TYPE_AUDIENCE[NotifType.support]).toBe(NotifAudience.user);
    expect(TYPE_AUDIENCE[NotifType.support_ticket_reply]).toBe(
      NotifAudience.admin,
    );
  });
});

describe("isStaffRole", () => {
  it("admits admins and super admins", () => {
    expect(isStaffRole(UserRole.admin)).toBe(true);
    expect(isStaffRole(UserRole.super_admin)).toBe(true);
  });

  it("refuses regular users and anything unrecognised", () => {
    expect(isStaffRole(UserRole.user)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
    expect(isStaffRole("")).toBe(false);
    // A forged or renamed role must not accidentally pass.
    expect(isStaffRole("administrator")).toBe(false);
    expect(isStaffRole("ADMIN")).toBe(false);
  });
});
