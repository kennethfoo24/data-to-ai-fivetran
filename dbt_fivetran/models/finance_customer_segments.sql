WITH payment_stats AS (
  SELECT
    i.customer_id,
    COUNT(i.invoice_id)                                 AS total_invoices,
    SUM(CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END) AS paid_invoices,
    SUM(p.amount_paid)                                  AS total_paid,
    MAX(p.payment_date)                                 AS last_payment_date
  FROM {{ source('finance_raw', 'FINANCE_INVOICES') }} i
  LEFT JOIN {{ source('finance_raw', 'FINANCE_PAYMENTS') }} p ON i.invoice_id = p.invoice_id
  GROUP BY i.customer_id
)
SELECT
  customer_id,
  total_invoices,
  paid_invoices,
  total_paid,
  last_payment_date,
  CASE
    WHEN paid_invoices::float / NULLIF(total_invoices, 0) >= 0.9
         AND last_payment_date >= CURRENT_DATE - 90 THEN 'champion'
    WHEN paid_invoices::float / NULLIF(total_invoices, 0) >= 0.5 THEN 'at_risk'
    ELSE 'churned'
  END AS segment
FROM payment_stats
