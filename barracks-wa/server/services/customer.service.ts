import type { Pool } from "pg";
import type { Db } from "@/server/db/transaction";
import { hashPassword } from "@/server/services/password.service";
import type {
  CustomerProfileInput,
  CustomerSignupInput,
  WalkinCustomerProfileInput,
} from "@/server/schemas/sprint.schema";

type CustomerRow = {
  id: number;
  user_id: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  preferred_barber_id: number | null;
  preferred_barber_name: string | null;
  loyalty_points: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CustomerRecord = {
  id: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredBarberId: number | null;
  preferredBarberName: string | null;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomerInput = CustomerSignupInput;
export type RegisteredCustomerRecord = CustomerRecord & { userId: number };

const customerSelect = `
  SELECT
    c.id,
    c.user_id,
    COALESCE(u.first_name, c.first_name) AS first_name,
    COALESCE(u.last_name, c.last_name) AS last_name,
    u.email,
    c.phone,
    c.preferred_barber_id,
    CASE
      WHEN b.id IS NULL THEN NULL
      ELSE CONCAT(b.first_name, ' ', b.last_name)
    END AS preferred_barber_name,
    c.loyalty_points,
    c.created_at,
    c.updated_at
  FROM customers c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN barbers b ON b.id = c.preferred_barber_id
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: Number(row.id),
    userId: row.user_id === null ? null : Number(row.user_id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? "",
    phone: row.phone,
    preferredBarberId: row.preferred_barber_id === null ? null : Number(row.preferred_barber_id),
    preferredBarberName: row.preferred_barber_name,
    loyaltyPoints: Number(row.loyalty_points),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listCustomers(db: Pool): Promise<CustomerRecord[]> {
  const result = await db.query<CustomerRow>(
    `${customerSelect}
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE c.user_id IS NULL OR (u.deleted_at IS NULL AND r.name = 'customer')
      ORDER BY COALESCE(u.first_name, c.first_name) ASC, COALESCE(u.last_name, c.last_name) ASC, c.id ASC`,
  );
  return result.rows.map(toCustomer);
}

export async function findCustomerById(db: Db, id: number): Promise<CustomerRecord | null> {
  const result = await db.query<CustomerRow>(
    `${customerSelect}
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE c.id = $1 AND (c.user_id IS NULL OR (u.deleted_at IS NULL AND r.name = 'customer'))
      LIMIT 1`,
    [id],
  );
  return result.rows[0] ? toCustomer(result.rows[0]) : null;
}

export async function findCustomerByUserId(
  db: Pool,
  userId: number,
): Promise<RegisteredCustomerRecord | null> {
  const result = await db.query<CustomerRow>(
    `${customerSelect}
      INNER JOIN roles r ON r.id = u.role_id AND r.name = 'customer' AND u.deleted_at IS NULL
      WHERE c.user_id = $1
      LIMIT 1`,
    [userId],
  );
  const customer = result.rows[0] ? toCustomer(result.rows[0]) : null;
  return customer && customer.userId !== null ? { ...customer, userId: customer.userId } : null;
}

export async function createCustomer(
  db: Pool,
  input: CreateCustomerInput,
): Promise<{ kind: "created"; customer: RegisteredCustomerRecord } | { kind: "duplicate" }> {
  // Hash first: this is slow and must not hold a connection or transaction open.
  const passwordHash = await hashPassword(input.password);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const existingUser = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1",
      [input.email],
    );

    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "duplicate" };
    }

    const role = await client.query<{ id: number }>(
      "SELECT id FROM roles WHERE name = 'customer' LIMIT 1",
    );
    if (!role.rows[0]) {
      throw new Error("Customer role is missing; run the database migration first");
    }

    const insertedUser = await client.query<{ id: number }>(
      `
        INSERT INTO users (first_name, last_name, email, password_hash, role_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [input.firstName, input.lastName, input.email, passwordHash, role.rows[0].id],
    );

    const insertedCustomer = await client.query<{ id: number }>(
      `
        INSERT INTO customers (user_id, phone, preferred_barber_id)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [insertedUser.rows[0].id, input.phone, input.preferredBarberId],
    );

    // Read on this connection so a small pool cannot wait on itself.
    const customer = await findCustomerById(client, insertedCustomer.rows[0].id);
    if (!customer || customer.userId === null)
      throw new Error("Unable to read created customer account");
    await client.query("COMMIT");
    return { kind: "created", customer: { ...customer, userId: customer.userId } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isUniqueViolation(error)) return { kind: "duplicate" };
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCustomer(
  db: Pool,
  id: number,
  input: CustomerProfileInput | WalkinCustomerProfileInput,
): Promise<CustomerRecord | null> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const target = await client.query<{ user_id: number | null }>(
      `
        SELECT c.user_id
        FROM customers c
        LEFT JOIN users u ON u.id = c.user_id
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE c.id = $1 AND (c.user_id IS NULL OR (r.name = 'customer' AND u.deleted_at IS NULL))
        LIMIT 1
        FOR UPDATE OF c
      `,
      [id],
    );

    if (!target.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    if (target.rows[0].user_id === null) {
      if ("email" in input) throw new Error("Walk-in records do not have a login email");
      await client.query(
        `UPDATE customers SET first_name = $1, last_name = $2 WHERE id = $3`,
        [input.firstName, input.lastName, id],
      );
    } else {
      if (!("email" in input)) throw new Error("Email is required for registered customers");
      await client.query(
        `
          UPDATE users
          SET first_name = $1, last_name = $2, email = $3, updated_at = NOW()
          WHERE id = $4
        `,
        [input.firstName, input.lastName, input.email, target.rows[0].user_id],
      );
    }
    await client.query(
      `
        UPDATE customers
        SET phone = $1, preferred_barber_id = $2,
            loyalty_points = COALESCE($3, loyalty_points), updated_at = NOW()
        WHERE id = $4
      `,
      [input.phone, input.preferredBarberId, input.loyaltyPoints ?? null, id],
    );

    const customer = await findCustomerById(client, id);
    await client.query("COMMIT");
    return customer;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isUniqueViolation(error)) throw new Error("A user with this email already exists");
    throw error;
  } finally {
    client.release();
  }
}

export type DeleteCustomerResult = "deleted" | "not_found" | "active_bookings";

export async function deleteCustomer(db: Pool, id: number): Promise<DeleteCustomerResult> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const target = await client.query<{ user_id: number }>(
      `
        SELECT c.user_id
        FROM customers c
        INNER JOIN users u ON u.id = c.user_id
        INNER JOIN roles r ON r.id = u.role_id AND r.name = 'customer'
        WHERE c.id = $1 AND u.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF c, u
      `,
      [id],
    );

    if (!target.rows[0]) {
      await client.query("ROLLBACK");
      return "not_found";
    }

    const activeBooking = await client.query<{ id: number }>(
      `SELECT id FROM bookings
       WHERE customer_id = $1 AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')
       LIMIT 1`,
      [id],
    );
    if (activeBooking.rowCount) {
      await client.query("ROLLBACK");
      return "active_bookings";
    }

    const deleted = await client.query<{ id: number }>(
      `
        UPDATE users
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `,
      [target.rows[0].user_id],
    );

    if (!deleted.rowCount) {
      await client.query("ROLLBACK");
      return "not_found";
    }

    await client.query("DELETE FROM sessions WHERE user_id = $1", [deleted.rows[0].id]);
    await client.query("COMMIT");
    return "deleted";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}
