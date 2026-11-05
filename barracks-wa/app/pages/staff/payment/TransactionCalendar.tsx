"use client";

import { useState } from "react";
import { Button, IconButton, Panel, SelectField, TextField } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import type { TransactionRecord } from "@/server/services/payment.service";
import { dayLabel, manilaDate, methods, money } from "./labels";

export function TransactionCalendar({
  history,
  transactionsByDay,
  loading,
  loadError,
  month,
  search,
  methodFilter,
  onMonthChange,
  onSearch,
  onMethodFilterChange,
  onResetFilters,
  onOpenDay,
}: {
  history: TransactionRecord[];
  transactionsByDay: Map<string, TransactionRecord[]>;
  loading: boolean;
  loadError: string;
  month: string;
  search: string;
  methodFilter: string;
  onMonthChange: (month: string) => void;
  onSearch: (search: string) => void;
  onMethodFilterChange: (method: string) => void;
  onResetFilters: () => void;
  onOpenDay: (day: string) => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const dateFrom = `${month}-01`;
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const monthDayCount = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const monthTotal = history.reduce(
    (sum, transaction) => sum + (transaction.status === "completed" ? transaction.total : 0),
    0,
  );
  const today = manilaDate(new Date());
  const currentMonth = today.slice(0, 7);
  const monthStart = new Date(`${dateFrom}T12:00:00Z`);
  const calendarOffset = (monthStart.getUTCDay() + 6) % 7;
  const calendarDays = Array.from(
    { length: monthDayCount },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const moveMonth = (offset: number) => {
    const next = new Date(`${dateFrom}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + offset);
    onMonthChange(next.toISOString().slice(0, 7));
  };

  return (
    <Panel className="recent-transactions-panel">
      <div className="transaction-calendar-head">
        <div className="transaction-calendar-navigation">
          <IconButton label="Previous month" icon="chevronLeft" onClick={() => moveMonth(-1)} />
          <h2>
            {monthStart.toLocaleDateString("en-PH", {
              timeZone: "Asia/Manila",
              month: "long",
              year: "numeric",
            })}
          </h2>
          <IconButton label="Next month" icon="chevronRight" onClick={() => moveMonth(1)} />
          {month !== currentMonth && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onMonthChange(currentMonth)}
            >
              Today
            </Button>
          )}
        </div>
        {!loading && !loadError && (
          <p className="transaction-calendar-total">
            <span>
              {history.length} transactions this month
              {search || methodFilter ? " matching the active filters" : ""}.
            </span>
            <strong>{money(monthTotal)}</strong>
          </p>
        )}
      </div>
      <form
        className="transaction-filters"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(searchInput);
        }}
      >
        <label className="search-input transaction-filters__search">
          <Icon name="search" size={16} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search reference or customer"
            aria-label="Reference or customer"
          />
        </label>
        <SelectField
          value={methodFilter}
          aria-label="Payment method"
          onChange={(event) => onMethodFilterChange(event.target.value)}
        >
          <option value="">All methods</option>
          {methods.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <TextField
          className="transaction-filters__month"
          type="month"
          value={month}
          aria-label="Month"
          onChange={(event) => {
            if (event.target.value) onMonthChange(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {(search || searchInput || methodFilter) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearchInput("");
              onResetFilters();
            }}
          >
            Reset filters
          </Button>
        )}
      </form>
      {loading && (
        <p role="status" className="operational-loading">
          Loading transaction calendar…
        </p>
      )}
      {!loading && loadError && (
        <p role="alert" className="operational-loading">
          {loadError}
        </p>
      )}
      {!loading && !loadError && (
        <div className="transaction-calendar" aria-label="Transaction dates">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="transaction-calendar__weekday">
              {day}
            </div>
          ))}
          {Array.from({ length: calendarOffset }, (_, index) => (
            <div
              key={`blank-${index}`}
              aria-hidden="true"
              className="transaction-calendar__blank"
            />
          ))}
          {calendarDays.map((day) => {
            const entries = transactionsByDay.get(day) ?? [];
            const count = entries.length;
            const total = entries.reduce(
              (sum, entry) => sum + (entry.status === "completed" ? entry.total : 0),
              0,
            );
            return (
              <button
                type="button"
                key={day}
                className={`transaction-calendar__day${count ? " has-activity" : ""}${day > today ? " is-future" : ""}`}
                aria-current={day === today ? "date" : undefined}
                aria-label={`${dayLabel(day)}, ${count} ${count === 1 ? "transaction" : "transactions"}`}
                onClick={() => {
                  onOpenDay(day);
                }}
              >
                <span>{Number(day.slice(-2))}</span>
                {count > 0 && (
                  <>
                    <strong>{money(total)}</strong>
                    <small>
                      {count} {count === 1 ? "sale" : "sales"}
                    </small>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
