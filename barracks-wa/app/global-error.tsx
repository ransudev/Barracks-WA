"use client";

// Last resort for a failure in the root layout, which replaces the whole document.
export default function GlobalError() {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1>This page could not be displayed</h1>
        <p>Your saved data is not affected. Reload the page to try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </body>
    </html>
  );
}
