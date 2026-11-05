"use client";

import { Button, Panel } from "@/app/components/ui";
import { ResponsiveTable } from "@/app/components/operations/OperationalPrimitives";
import type { ApiRole } from "@/app/lib/api";
import type { PayrollOverview } from "@/app/types/payroll";
import { dateTime, payrollMoney } from "@/app/utils/payroll";
import { CorrectionApprovals } from "./PayrollPanels";
import type { Editor } from "./shared";

export function PayrollSettings({
  overview,
  currentUserRole,
  onEdit: edit,
}: {
  overview: PayrollOverview;
  currentUserRole: ApiRole;
  onEdit: (editor: Editor) => void;
}) {
  return (
    <>
      <Panel>
        <h2>Payroll calendar</h2>
        {overview.settings ? (
          <p>
            First period starts {overview.settings.anchor_date}. Every period lasts 14 days in
            Asia/Manila.
          </p>
        ) : (
          <>
            <p>Choose the first period start date before generating payroll.</p>
            <Button onClick={() => edit({ kind: "configure" })}>Configure calendar</Button>
          </>
        )}
      </Panel>
      <Panel>
        <h2>Commission rates</h2>
        <p className="payroll-muted">Rate changes apply to future services only.</p>
        <ResponsiveTable
          className="payroll-rates-table"
          headers={["Barber", "Current rate", "Action"]}
        >
          {overview.rates.map((barber) => (
            <tr key={barber.id}>
              <td>
                {barber.first_name} {barber.last_name}
              </td>
              <td>{barber.current_rate === null ? "Not configured" : `${barber.current_rate}%`}</td>
              <td>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => edit({ kind: "rate", barber })}
                >
                  Set future rate
                </Button>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
        {overview.rates.map((barber) => (
          <details className="payroll-rate-history" key={barber.id}>
            <summary>
              {barber.first_name} {barber.last_name} · Rate history ({barber.history.length})
            </summary>
            <ul>
              {barber.history.map((change) => (
                <li key={change.id}>
                  {change.old_rate ?? "Unconfigured"} → {change.commission_rate}% ·{" "}
                  {dateTime(change.effective_at)} · {change.actor_name || "Payroll activation"}
                  <p>{change.change_reason}</p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </Panel>
      {overview.unresolved.length > 0 && (
        <Panel>
          <h2>Historical rates to confirm ({overview.unresolved.length})</h2>
          <p className="payroll-muted">
            A manager must confirm the rate and evidence before these services accrue commission.
          </p>
          <ResponsiveTable
            className="payroll-unresolved-table"
            headers={[
              "Barber / service",
              "Completed in Manila",
              "Original price",
              "Payment",
              "Action",
            ]}
          >
            {overview.unresolved.map((service) => (
              <tr key={service.id}>
                <td>
                  {service.barber_name}
                  <small>{service.service_name}</small>
                </td>
                <td>{dateTime(service.completed_at)}</td>
                <td>{payrollMoney(service.original_price_centavos)}</td>
                <td>
                  {service.transaction_reference ?? "Unpaid"}
                  <small>{service.transaction_status}</small>
                </td>
                <td>
                  {currentUserRole === "manager" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => edit({ kind: "correct_snapshot", service })}
                    >
                      Confirm historical rate
                    </Button>
                  ) : (
                    "Manager confirmation required"
                  )}
                </td>
              </tr>
            ))}
          </ResponsiveTable>
        </Panel>
      )}
      {overview.corrections.length > 0 && (
        <CorrectionApprovals corrections={overview.corrections} />
      )}
    </>
  );
}
